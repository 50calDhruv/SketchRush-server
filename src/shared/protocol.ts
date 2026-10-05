/**
 * Wire protocol shared by the server and the client.
 *
 * The server owns this file; the client imports it through the `@shared` alias so the two can
 * never drift. Keep it dependency-free (plain types and constants) so it works in both runtimes.
 * The server validates every client payload against these limits — the client only mirrors them
 * for UX (input `maxLength`, select options).
 */

export const LIMITS = {
  nameMaxLength: 20,
  chatMaxLength: 100,
  roomCodeLength: 6,
  minPlayers: 2,
  /** Max numbers (x,y pairs flattened) in one draw message. */
  pointsPerMessage: 1024,
} as const;

export const SETTINGS_BOUNDS = {
  rounds: { min: 1, max: 10, default: 3 },
  drawTime: { min: 30, max: 180, step: 10, default: 80 },
  maxPlayers: { min: 2, max: 12, default: 8 },
} as const;

/** Logical canvas size. Points travel normalized to 0..1; brush sizes are in these units. */
export const CANVAS = { width: 800, height: 600 } as const;
export const BRUSH_SIZES = [4, 10, 20, 36] as const;

export type Phase = "lobby" | "choosing" | "drawing" | "turnEnd" | "gameOver";

export type RoomSettings = {
  rounds: number;
  /** Seconds per drawing turn. */
  drawTime: number;
  maxPlayers: number;
  isPublic: boolean;
};

export type PlayerView = {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  hasGuessed: boolean;
};

export type TurnEndReason = "timeout" | "allGuessed" | "drawerLeft";

export type TurnResult = {
  word: string;
  drawerId: string;
  reason: TurnEndReason;
  /** Points gained this turn, keyed by player id. */
  gains: Record<string, number>;
};

export type RoomView = {
  code: string;
  hostId: string;
  settings: RoomSettings;
  players: PlayerView[];
  phase: Phase;
  round: number;
  drawerId: string | null;
  /** One entry per character of the word: the letter once revealed, `null` while hidden. */
  hint: (string | null)[] | null;
  /** Milliseconds left in the current phase at the moment this state was sent. */
  phaseRemainingMs: number | null;
  turnResult: TurnResult | null;
  /** Viewer-specific: only the drawer and players who already guessed receive the word. */
  word: string | null;
  /** Viewer-specific: only the drawer receives choices, only while choosing. */
  wordChoices: string[] | null;
};

export type Stroke = {
  id: string;
  color: string;
  size: number;
  /** Flattened normalized coordinates: [x0, y0, x1, y1, ...], each in 0..1. */
  points: number[];
};

/** A chunk of a stroke in flight. The first chunk for an unknown id starts a new stroke. */
export type StrokeSegment = Stroke;

export type ChatMessage =
  | {
      id: string;
      kind: "player";
      playerId: string;
      name: string;
      text: string;
      /** "guessers" = only visible to the drawer and players who already guessed. */
      scope: "all" | "guessers";
    }
  | {
      id: string;
      kind: "system";
      tone: "info" | "success" | "warning" | "close";
      text: string;
    };

export type PublicRoomSummary = {
  code: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  inGame: boolean;
};

export type AckResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export type JoinResult = AckResult<{ playerId: string; code: string }>;

export interface ServerToClientEvents {
  /** Sent first on every connection; `playerId` is set when the session resumed a room seat. */
  "session:init": (data: { playerId: string | null }) => void;
  /** This session was opened in another tab; this socket is about to be disconnected. */
  "session:replaced": () => void;
  "room:state": (room: RoomView) => void;
  "chat:message": (message: ChatMessage) => void;
  "draw:points": (segment: StrokeSegment) => void;
  "draw:undo": (data: { strokeId: string }) => void;
  "draw:clear": () => void;
  "canvas:sync": (data: { strokes: Stroke[] }) => void;
  "lobby:rooms": (rooms: PublicRoomSummary[]) => void;
}

export interface ClientToServerEvents {
  "room:create": (data: { name: string }, ack: (result: JoinResult) => void) => void;
  "room:join": (data: { code: string; name: string }, ack: (result: JoinResult) => void) => void;
  "room:leave": () => void;
  "room:settings": (data: Partial<RoomSettings>) => void;
  "game:start": (ack: (result: AckResult) => void) => void;
  "game:choose-word": (data: { index: number }) => void;
  "chat:send": (data: { text: string }) => void;
  "draw:points": (segment: StrokeSegment) => void;
  "draw:undo": () => void;
  "draw:clear": () => void;
  "lobby:subscribe": () => void;
  "lobby:unsubscribe": () => void;
}
