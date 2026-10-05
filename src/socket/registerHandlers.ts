import type { z } from "zod";

import { LOBBY_CHANNEL, type RoomManager } from "../game/RoomManager.js";
import type { Room } from "../game/Room.js";
import type { GameServer, GameSocket } from "../game/types.js";
import type { AckResult, JoinResult } from "../shared/protocol.js";
import { createRateLimiter } from "./rateLimit.js";
import {
  chatSchema,
  chooseWordSchema,
  createRoomSchema,
  handshakeSchema,
  joinRoomSchema,
  settingsSchema,
  strokeSegmentSchema,
} from "./schemas.js";

const logFailure = (event: string, error: unknown) =>
  console.error(`[socket] "${event}" handler failed`, error);

/** Validates the payload, drops it if malformed, and keeps a thrown error from killing the process. */
const handle =
  <T>(event: string, schema: z.ZodType<T>, fn: (data: T) => void) =>
  (raw: unknown) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return;
    try {
      fn(parsed.data);
    } catch (error) {
      logFailure(event, error);
    }
  };

/** Same as `handle`, for request/response events that reply through an acknowledgement. */
const handleWithAck =
  <T, R extends AckResult>(event: string, schema: z.ZodType<T>, fn: (data: T) => R) =>
  (raw: unknown, ack: unknown) => {
    if (typeof ack !== "function") return;
    const reply = ack as (result: R | AckResult) => void;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return reply({ ok: false, error: "That request looks invalid." });
    try {
      reply(fn(parsed.data));
    } catch (error) {
      logFailure(event, error);
      reply({ ok: false, error: "Something went wrong. Please try again." });
    }
  };

export const registerHandlers = (io: GameServer, rooms: RoomManager): void => {
  io.use((socket, next) => {
    const parsed = handshakeSchema.safeParse(socket.handshake.auth);
    if (!parsed.success) return next(new Error("Invalid session"));
    socket.data.sessionId = parsed.data.sessionId;
    next();
  });

  io.on("connection", (socket) => onConnection(rooms, socket));
};

const onConnection = (rooms: RoomManager, socket: GameSocket): void => {
  const { sessionId } = socket.data;
  const allowChat = createRateLimiter(5, 1.5);
  const allowDraw = createRateLimiter(120, 60);

  // Resume a seat held for this session (refresh or reconnect), before anything else is sent.
  const resumedRoom = rooms.roomOf(sessionId);
  socket.emit("session:init", { playerId: resumedRoom?.playerIdFor(sessionId) ?? null });
  resumedRoom?.resume(socket);

  /** Runs `fn` with the caller's room and player id; silently ignores callers not in a room. */
  const asPlayer = (fn: (room: Room, playerId: string) => void) => {
    const room = rooms.roomOf(sessionId);
    const playerId = room?.playerIdFor(sessionId);
    if (room && playerId) fn(room, playerId);
  };

  const enterRoom = (room: Room, name: string): JoinResult => {
    rooms.roomOf(sessionId)?.leave(sessionId);
    rooms.bind(sessionId, room);
    void socket.leave(LOBBY_CHANNEL);
    const playerId = room.addPlayer(socket, name);
    return { ok: true, playerId, code: room.code };
  };

  socket.on(
    "room:create",
    handleWithAck("room:create", createRoomSchema, ({ name }) => enterRoom(rooms.create(), name)),
  );

  socket.on(
    "room:join",
    handleWithAck("room:join", joinRoomSchema, ({ code, name }): JoinResult => {
      const room = rooms.get(code);
      if (!room) return { ok: false, error: "No room with that code. Check it and try again." };

      const existingId = room.playerIdFor(sessionId);
      if (existingId) {
        room.resume(socket);
        return { ok: true, playerId: existingId, code };
      }
      if (room.isFull()) return { ok: false, error: "That room is full." };
      return enterRoom(room, name);
    }),
  );

  socket.on("room:leave", () => rooms.roomOf(sessionId)?.leave(sessionId));

  socket.on(
    "room:settings",
    handle("room:settings", settingsSchema, (patch) =>
      asPlayer((room, playerId) => room.updateSettings(playerId, patch)),
    ),
  );

  socket.on("game:start", (ack: unknown) => {
    if (typeof ack !== "function") return;
    const reply = ack as (result: AckResult) => void;
    const room = rooms.roomOf(sessionId);
    const playerId = room?.playerIdFor(sessionId);
    if (!room || !playerId) return reply({ ok: false, error: "You're not in a room." });
    try {
      const error = room.startGame(playerId);
      reply(error ? { ok: false, error } : { ok: true });
    } catch (error) {
      logFailure("game:start", error);
      reply({ ok: false, error: "Something went wrong. Please try again." });
    }
  });

  socket.on(
    "game:choose-word",
    handle("game:choose-word", chooseWordSchema, ({ index }) =>
      asPlayer((room, playerId) => room.chooseWord(playerId, index)),
    ),
  );

  socket.on(
    "chat:send",
    handle("chat:send", chatSchema, ({ text }) => {
      if (allowChat()) asPlayer((room, playerId) => room.handleChat(playerId, text));
    }),
  );

  socket.on(
    "draw:points",
    handle("draw:points", strokeSegmentSchema, (segment) => {
      if (allowDraw()) asPlayer((room, playerId) => room.handleDraw(playerId, segment));
    }),
  );

  socket.on("draw:undo", () => asPlayer((room, playerId) => room.handleUndo(playerId)));
  socket.on("draw:clear", () => asPlayer((room, playerId) => room.handleClear(playerId)));

  socket.on("lobby:subscribe", () => {
    void socket.join(LOBBY_CHANNEL);
    socket.emit("lobby:rooms", rooms.publicRooms());
  });
  socket.on("lobby:unsubscribe", () => void socket.leave(LOBBY_CHANNEL));

  socket.on("disconnect", () => rooms.roomOf(sessionId)?.handleDisconnect(socket.id));
};
