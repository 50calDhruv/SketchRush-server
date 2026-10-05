import { randomInt, randomUUID } from "node:crypto";

import {
  LIMITS,
  SETTINGS_BOUNDS,
  type ChatMessage,
  type Phase,
  type PublicRoomSummary,
  type RoomSettings,
  type RoomView,
  type Stroke,
  type StrokeSegment,
  type TurnEndReason,
  type TurnResult,
} from "../shared/protocol.js";
import {
  DRAWER_POINTS_PER_GUESS,
  TIMINGS,
  WORD_CHOICE_COUNT,
  evaluateGuess,
  guesserPoints,
  hintSchedule,
  maskWord,
} from "./rules.js";
import type { GameServer, GameSocket } from "./types.js";
import { pickWords } from "./words.js";

// Per-turn caps so a single drawer cannot grow server memory without bound.
const MAX_STROKES_PER_TURN = 2_000;
const MAX_POINTS_PER_TURN = 400_000;

type Player = {
  /** Public id, safe to broadcast. */
  id: string;
  /** Private reconnect secret; never leaves the server. */
  sessionId: string;
  name: string;
  score: number;
  /** `null` while disconnected (inside the reconnect grace window). */
  socketId: string | null;
  removalTimer: NodeJS.Timeout | null;
};

type Turn = {
  drawerId: string;
  choices: string[];
  word: string | null;
  guessed: Set<string>;
  gains: Map<string, number>;
  revealed: Set<number>;
  strokes: Stroke[];
  strokesById: Map<string, Stroke>;
  pointCount: number;
};

export type RoomHooks = {
  onPlayerRemoved: (room: Room, sessionId: string) => void;
  onEmpty: (room: Room) => void;
  /** Something shown in the public room list changed. */
  onListingChange: () => void;
};

/**
 * One game room: its players, settings, and the turn state machine
 * `lobby → choosing → drawing → turnEnd → (choosing …) → gameOver → lobby`.
 *
 * All game rules are enforced here; the socket layer only validates payload shape and routes.
 */
export class Room {
  private readonly players = new Map<string, Player>(); // insertion order = join order
  private hostId = "";
  private settings: RoomSettings = {
    rounds: SETTINGS_BOUNDS.rounds.default,
    drawTime: SETTINGS_BOUNDS.drawTime.default,
    maxPlayers: SETTINGS_BOUNDS.maxPlayers.default,
    isPublic: false,
  };
  private phase: Phase = "lobby";
  private round = 0;
  private drawQueue: string[] = [];
  private turn: Turn | null = null;
  private turnResult: TurnResult | null = null;
  private phaseEndsAt: number | null = null;
  private readonly phaseTimers = new Set<NodeJS.Timeout>();

  constructor(
    readonly code: string,
    private readonly io: GameServer,
    private readonly hooks: RoomHooks,
  ) {}

  // ── Membership ────────────────────────────────────────────────────────────

  isFull(): boolean {
    return this.players.size >= this.settings.maxPlayers;
  }

  playerIdFor(sessionId: string): string | null {
    return this.findBySession(sessionId)?.id ?? null;
  }

  /** Seats a new player on this socket. Callers check `isFull()` first. */
  addPlayer(socket: GameSocket, name: string): string {
    const player: Player = {
      id: randomUUID(),
      sessionId: socket.data.sessionId,
      name,
      score: 0,
      socketId: null,
      removalTimer: null,
    };
    this.players.set(player.id, player);
    if (!this.hostId) this.hostId = player.id;
    else this.systemMessage(`${name} joined the room`);
    this.attach(player, socket);
    this.hooks.onListingChange();
    return player.id;
  }

  /** Re-seats a returning session (page refresh, network blip, or another tab taking over). */
  resume(socket: GameSocket): void {
    const player = this.findBySession(socket.data.sessionId);
    if (player) this.attach(player, socket);
  }

  leave(sessionId: string): void {
    const player = this.findBySession(sessionId);
    if (player) this.removePlayer(player.id);
  }

  handleDisconnect(socketId: string): void {
    const player = [...this.players.values()].find((p) => p.socketId === socketId);
    if (!player) return;

    player.socketId = null;
    player.removalTimer = setTimeout(() => this.removePlayer(player.id), TIMINGS.reconnectGraceMs);

    if (this.phase === "drawing" && this.everyoneGuessed()) return this.endTurn("allGuessed");
    this.emitState();
  }

  /** Stops every timer. The room must not be used afterwards. */
  destroy(): void {
    this.clearPhaseTimers();
    for (const player of this.players.values()) {
      if (player.removalTimer) clearTimeout(player.removalTimer);
    }
  }

  summary(): PublicRoomSummary | null {
    if (!this.settings.isPublic) return null;
    return {
      code: this.code,
      hostName: this.players.get(this.hostId)?.name ?? "",
      playerCount: this.players.size,
      maxPlayers: this.settings.maxPlayers,
      inGame: this.phase !== "lobby",
    };
  }

  private attach(player: Player, socket: GameSocket): void {
    const previousSocketId = player.socketId;
    player.socketId = socket.id;
    if (player.removalTimer) {
      clearTimeout(player.removalTimer);
      player.removalTimer = null;
    }

    // The same session opened elsewhere: the newest tab wins.
    if (previousSocketId && previousSocketId !== socket.id) {
      this.io.to(previousSocketId).emit("session:replaced");
      this.io.in(previousSocketId).disconnectSockets();
    }

    void socket.join(this.code);
    if (this.turn && (this.phase === "drawing" || this.phase === "turnEnd")) {
      socket.emit("canvas:sync", { strokes: this.turn.strokes });
    }
    this.emitState();
  }

  private removePlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;

    if (player.removalTimer) clearTimeout(player.removalTimer);
    this.players.delete(playerId);
    if (player.socketId) this.io.in(player.socketId).socketsLeave(this.code);
    this.hooks.onPlayerRemoved(this, player.sessionId);

    if (this.players.size === 0) {
      this.destroy();
      this.hooks.onEmpty(this);
      return;
    }

    if (this.hostId === playerId) {
      const next = this.connectedPlayers()[0] ?? this.players.values().next().value;
      if (next) this.hostId = next.id;
    }
    this.systemMessage(`${player.name} left the room`);
    this.hooks.onListingChange();

    if (this.isMidGame()) {
      if (this.connectedPlayers().length < LIMITS.minPlayers) {
        return this.abortGame("Not enough players to keep going. Back to the lobby!");
      }
      const drawerLeft = this.turn?.drawerId === playerId;
      if (drawerLeft && (this.phase === "choosing" || this.phase === "drawing")) {
        return this.endTurn("drawerLeft");
      }
      if (this.phase === "drawing" && this.everyoneGuessed()) return this.endTurn("allGuessed");
    }
    this.emitState();
  }

  // ── Settings & game flow ──────────────────────────────────────────────────

  updateSettings(playerId: string, patch: Partial<RoomSettings>): void {
    if (playerId !== this.hostId || this.phase !== "lobby") return;
    this.settings = {
      rounds: patch.rounds ?? this.settings.rounds,
      drawTime: patch.drawTime ?? this.settings.drawTime,
      // Never shrink below the people already here.
      maxPlayers: Math.max(patch.maxPlayers ?? this.settings.maxPlayers, this.players.size),
      isPublic: patch.isPublic ?? this.settings.isPublic,
    };
    this.emitState();
    this.hooks.onListingChange();
  }

  /** Returns an error message, or `null` when the game started. */
  startGame(playerId: string): string | null {
    if (playerId !== this.hostId) return "Only the host can start the game.";
    if (this.phase !== "lobby") return "The game has already started.";

    const ready = this.connectedPlayers();
    if (ready.length < LIMITS.minPlayers) {
      return `You need at least ${LIMITS.minPlayers} players to start.`;
    }

    for (const player of this.players.values()) player.score = 0;
    this.round = 1;
    this.drawQueue = ready.map((p) => p.id);
    this.hooks.onListingChange();
    this.nextTurn();
    return null;
  }

  chooseWord(playerId: string, index: number): void {
    const turn = this.turn;
    if (this.phase !== "choosing" || !turn || turn.drawerId !== playerId) return;
    const word = turn.choices[index];
    if (!word) return;

    turn.word = word;
    const drawMs = this.settings.drawTime * 1000;
    this.setPhase("drawing", drawMs, () => this.endTurn("timeout"));
    for (const reveal of hintSchedule(word, drawMs)) {
      this.schedule(reveal.atMs, () => {
        turn.revealed.add(reveal.index);
        this.emitState();
      });
    }

    const drawer = this.players.get(playerId);
    if (drawer) this.systemMessage(`${drawer.name} is drawing now!`);
    this.emitState();
  }

  private nextTurn(): void {
    let drawerId = this.takeNextDrawer();
    if (!drawerId) {
      if (this.round >= this.settings.rounds) return this.endGame();
      this.round++;
      this.drawQueue = this.connectedPlayers().map((p) => p.id);
      drawerId = this.takeNextDrawer();
    }
    if (!drawerId || this.connectedPlayers().length < LIMITS.minPlayers) {
      return this.abortGame("Not enough players to keep going. Back to the lobby!");
    }

    const drawer = drawerId;
    const choices = pickWords(WORD_CHOICE_COUNT);
    this.turn = {
      drawerId: drawer,
      choices,
      word: null,
      guessed: new Set(),
      gains: new Map(),
      revealed: new Set(),
      strokes: [],
      strokesById: new Map(),
      pointCount: 0,
    };
    this.turnResult = null;
    // A drawer who never picks gets a random word rather than stalling the room.
    this.setPhase("choosing", TIMINGS.chooseMs, () =>
      this.chooseWord(drawer, randomInt(choices.length)),
    );
    this.io.to(this.code).emit("draw:clear");
    this.emitState();
  }

  /** Next player in this round's queue who is still here and connected. */
  private takeNextDrawer(): string | undefined {
    while (this.drawQueue.length > 0) {
      const id = this.drawQueue.shift();
      if (id && this.players.get(id)?.socketId) return id;
    }
    return undefined;
  }

  private endTurn(reason: TurnEndReason): void {
    const turn = this.turn;
    if (!turn || (this.phase !== "choosing" && this.phase !== "drawing")) return;

    // The drawer left before picking a word: nothing to reveal, move straight on.
    if (!turn.word) return this.nextTurn();

    this.turnResult = {
      word: turn.word,
      drawerId: turn.drawerId,
      reason,
      gains: Object.fromEntries(turn.gains),
    };
    this.systemMessage(`The word was "${turn.word}"`);
    this.setPhase("turnEnd", TIMINGS.turnEndMs, () => this.nextTurn());
    this.emitState();
  }

  private endGame(): void {
    this.turn = null;
    this.turnResult = null;
    this.setPhase("gameOver", TIMINGS.gameOverMs, () => this.returnToLobby());
    this.emitState();
  }

  private abortGame(reason: string): void {
    this.systemMessage(reason, "warning");
    this.returnToLobby();
  }

  private returnToLobby(): void {
    this.setPhase("lobby", null);
    this.round = 0;
    this.turn = null;
    this.turnResult = null;
    this.drawQueue = [];
    for (const player of this.players.values()) player.score = 0;
    this.io.to(this.code).emit("draw:clear");
    this.emitState();
    this.hooks.onListingChange();
  }

  private isMidGame(): boolean {
    return this.phase === "choosing" || this.phase === "drawing" || this.phase === "turnEnd";
  }

  // ── Chat & guessing ───────────────────────────────────────────────────────

  handleChat(playerId: string, text: string): void {
    const player = this.players.get(playerId);
    if (!player) return;

    const turn = this.turn;
    if (this.phase !== "drawing" || !turn?.word) {
      this.io.to(this.code).emit("chat:message", this.playerMessage(player, text, "all"));
      return;
    }

    // People who know the word can only talk among themselves, so they can't leak it.
    if (playerId === turn.drawerId || turn.guessed.has(playerId)) {
      const message = this.playerMessage(player, text, "guessers");
      for (const id of [turn.drawerId, ...turn.guessed]) {
        const socketId = this.players.get(id)?.socketId;
        if (socketId) this.io.to(socketId).emit("chat:message", message);
      }
      return;
    }

    const result = evaluateGuess(text, turn.word);
    if (result === "correct") return this.registerCorrectGuess(player, turn);

    this.io.to(this.code).emit("chat:message", this.playerMessage(player, text, "all"));
    if (result === "close" && player.socketId) {
      this.io.to(player.socketId).emit("chat:message", {
        id: randomUUID(),
        kind: "system",
        tone: "close",
        text: `"${text}" is close!`,
      });
    }
  }

  private registerCorrectGuess(player: Player, turn: Turn): void {
    const remainingMs = (this.phaseEndsAt ?? Date.now()) - Date.now();
    this.award(turn, player, guesserPoints(remainingMs, this.settings.drawTime * 1000));
    turn.guessed.add(player.id);

    const drawer = this.players.get(turn.drawerId);
    if (drawer) this.award(turn, drawer, DRAWER_POINTS_PER_GUESS);

    this.systemMessage(`${player.name} guessed the word!`, "success");
    if (this.everyoneGuessed()) return this.endTurn("allGuessed");
    this.emitState();
  }

  private award(turn: Turn, player: Player, points: number): void {
    player.score += points;
    turn.gains.set(player.id, (turn.gains.get(player.id) ?? 0) + points);
  }

  private everyoneGuessed(): boolean {
    const turn = this.turn;
    if (!turn || turn.guessed.size === 0) return false;
    return this.connectedPlayers().every((p) => p.id === turn.drawerId || turn.guessed.has(p.id));
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  handleDraw(playerId: string, segment: StrokeSegment): void {
    const turn = this.drawingTurnFor(playerId);
    if (!turn || turn.pointCount + segment.points.length > MAX_POINTS_PER_TURN) return;

    let stroke = turn.strokesById.get(segment.id);
    if (!stroke) {
      if (turn.strokes.length >= MAX_STROKES_PER_TURN) return;
      stroke = { id: segment.id, color: segment.color, size: segment.size, points: [] };
      turn.strokes.push(stroke);
      turn.strokesById.set(stroke.id, stroke);
    }
    stroke.points.push(...segment.points);
    turn.pointCount += segment.points.length;

    // The drawer already rendered it locally.
    const drawerSocketId = this.players.get(playerId)?.socketId;
    this.io
      .to(this.code)
      .except(drawerSocketId ?? [])
      .emit("draw:points", segment);
  }

  /** Undo and clear are echoed to everyone, the drawer included, so all canvases stay identical. */
  handleUndo(playerId: string): void {
    const turn = this.drawingTurnFor(playerId);
    const stroke = turn?.strokes.pop();
    if (!turn || !stroke) return;
    turn.strokesById.delete(stroke.id);
    turn.pointCount -= stroke.points.length;
    this.io.to(this.code).emit("draw:undo", { strokeId: stroke.id });
  }

  handleClear(playerId: string): void {
    const turn = this.drawingTurnFor(playerId);
    if (!turn) return;
    turn.strokes = [];
    turn.strokesById.clear();
    turn.pointCount = 0;
    this.io.to(this.code).emit("draw:clear");
  }

  private drawingTurnFor(playerId: string): Turn | null {
    return this.phase === "drawing" && this.turn?.drawerId === playerId ? this.turn : null;
  }

  // ── State broadcast ───────────────────────────────────────────────────────

  /**
   * Everyone gets the public view in one broadcast; only the few players allowed to see the
   * word (drawer, correct guessers) get an individual emit with the private fields filled in.
   */
  private emitState(): void {
    const view = this.publicView();
    const privileged = this.connectedPlayers().flatMap((player) => {
      const secret = this.privateFields(player.id);
      return secret.word !== null || secret.wordChoices !== null
        ? [{ socketId: player.socketId as string, secret }]
        : [];
    });

    this.io
      .to(this.code)
      .except(privileged.map((p) => p.socketId))
      .emit("room:state", view);
    for (const { socketId, secret } of privileged) {
      this.io.to(socketId).emit("room:state", { ...view, ...secret });
    }
  }

  private publicView(): RoomView {
    const turn = this.turn;
    return {
      code: this.code,
      hostId: this.hostId,
      settings: { ...this.settings },
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        connected: p.socketId !== null,
        hasGuessed: turn?.guessed.has(p.id) ?? false,
      })),
      phase: this.phase,
      round: this.round,
      drawerId: turn?.drawerId ?? null,
      hint: this.phase === "drawing" && turn?.word ? maskWord(turn.word, turn.revealed) : null,
      phaseRemainingMs: this.phaseEndsAt === null ? null : Math.max(0, this.phaseEndsAt - Date.now()),
      turnResult: this.turnResult,
      word: null,
      wordChoices: null,
    };
  }

  private privateFields(playerId: string): Pick<RoomView, "word" | "wordChoices"> {
    const turn = this.turn;
    const isDrawer = turn?.drawerId === playerId;
    if (this.phase === "choosing" && turn && isDrawer) {
      return { word: null, wordChoices: turn.choices };
    }
    if (this.phase === "drawing" && turn && (isDrawer || turn.guessed.has(playerId))) {
      return { word: turn.word, wordChoices: null };
    }
    return { word: null, wordChoices: null };
  }

  private playerMessage(player: Player, text: string, scope: "all" | "guessers"): ChatMessage {
    return { id: randomUUID(), kind: "player", playerId: player.id, name: player.name, text, scope };
  }

  private systemMessage(text: string, tone: "info" | "success" | "warning" = "info"): void {
    this.io.to(this.code).emit("chat:message", { id: randomUUID(), kind: "system", tone, text });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private findBySession(sessionId: string): Player | undefined {
    return [...this.players.values()].find((p) => p.sessionId === sessionId);
  }

  private connectedPlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.socketId !== null);
  }

  private setPhase(phase: Phase, durationMs: number | null, onExpire?: () => void): void {
    this.clearPhaseTimers();
    this.phase = phase;
    this.phaseEndsAt = durationMs === null ? null : Date.now() + durationMs;
    if (durationMs !== null && onExpire) this.schedule(durationMs, onExpire);
  }

  /** Phase-scoped timer: cleared automatically on the next phase change. */
  private schedule(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.phaseTimers.delete(timer);
      try {
        fn();
      } catch (error) {
        console.error(`[room ${this.code}] timer failed`, error);
      }
    }, ms);
    this.phaseTimers.add(timer);
  }

  private clearPhaseTimers(): void {
    for (const timer of this.phaseTimers) clearTimeout(timer);
    this.phaseTimers.clear();
  }
}
