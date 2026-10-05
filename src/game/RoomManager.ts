import { randomInt } from "node:crypto";

import { LIMITS, type PublicRoomSummary } from "../shared/protocol.js";
import { Room } from "./Room.js";
import type { GameServer } from "./types.js";

/** Socket.IO room for clients browsing the public room list. */
export const LOBBY_CHANNEL = "lobby";

// No 0/O or 1/I, so codes survive being read aloud.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LOBBY_BROADCAST_INTERVAL_MS = 1_000;
const MAX_LISTED_ROOMS = 50;

/**
 * In-memory registry of rooms and which session sits in which room.
 *
 * This is the one seam to replace when scaling past a single process: rooms are independent, so
 * they can be sharded by code behind sticky routing, with the Socket.IO Redis adapter for fan-out.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly sessions = new Map<string, Room>();
  private lobbyBroadcastTimer: NodeJS.Timeout | null = null;

  constructor(private readonly io: GameServer) {}

  get size(): number {
    return this.rooms.size;
  }

  create(): Room {
    const room = new Room(this.generateCode(), this.io, {
      onPlayerRemoved: (owner, sessionId) => {
        if (this.sessions.get(sessionId) === owner) this.sessions.delete(sessionId);
      },
      onEmpty: (owner) => {
        this.rooms.delete(owner.code);
        this.scheduleLobbyBroadcast();
      },
      onListingChange: () => this.scheduleLobbyBroadcast(),
    });
    this.rooms.set(room.code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  roomOf(sessionId: string): Room | undefined {
    return this.sessions.get(sessionId);
  }

  bind(sessionId: string, room: Room): void {
    this.sessions.set(sessionId, room);
  }

  publicRooms(): PublicRoomSummary[] {
    return [...this.rooms.values()]
      .flatMap((room) => room.summary() ?? [])
      .filter((summary) => summary.playerCount < summary.maxPlayers)
      .sort((a, b) => Number(a.inGame) - Number(b.inGame) || b.playerCount - a.playerCount)
      .slice(0, MAX_LISTED_ROOMS);
  }

  /** Coalesces bursts of joins/leaves into at most one list update per second. */
  scheduleLobbyBroadcast(): void {
    if (this.lobbyBroadcastTimer) return;
    this.lobbyBroadcastTimer = setTimeout(() => {
      this.lobbyBroadcastTimer = null;
      this.io.to(LOBBY_CHANNEL).emit("lobby:rooms", this.publicRooms());
    }, LOBBY_BROADCAST_INTERVAL_MS);
  }

  destroyAll(): void {
    if (this.lobbyBroadcastTimer) clearTimeout(this.lobbyBroadcastTimer);
    this.lobbyBroadcastTimer = null;
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
    this.sessions.clear();
  }

  private generateCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < LIMITS.roomCodeLength; i++) {
        code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
  }
}
