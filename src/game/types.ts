import type { Server, Socket } from "socket.io";

import type { ClientToServerEvents, ServerToClientEvents } from "../shared/protocol.js";

export type SocketData = {
  /** Private per-tab secret from the handshake; never sent to other clients. */
  sessionId: string;
};

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
