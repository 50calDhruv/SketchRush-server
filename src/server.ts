import { createServer } from "node:http";

import { Server } from "socket.io";

import { RoomManager } from "./game/RoomManager.js";
import type { GameServer } from "./game/types.js";
import { registerHandlers } from "./socket/registerHandlers.js";

type Options = { corsOrigins: string[] };

/** Builds the HTTP + Socket.IO server without listening, so tests can run it on a random port. */
export const createGameServer = ({ corsOrigins }: Options) => {
  const httpServer = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", rooms: rooms.size }));
      return;
    }
    res.writeHead(404).end();
  });

  const io: GameServer = new Server(httpServer, {
    cors: { origin: corsOrigins },
    // Largest legitimate client message is a draw batch (~20 KB).
    maxHttpBufferSize: 64 * 1024,
  });

  const rooms = new RoomManager(io);
  registerHandlers(io, rooms);

  const close = async () => {
    rooms.destroyAll();
    await io.close();
  };

  return { httpServer, io, rooms, close };
};
