import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

import { registerGameSocket } from "./socket/gameSocket";
import { roomManager } from "./game/roomManager";

const app = express();

app.use(cors());

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

io.on("connection", (socket) => {
  registerGameSocket(io, socket);
});

app.get("/", (_, res) => {
  res.send("SketchRush Server Running");
});

app.get(
  "/rooms",
  (_, res) => {

    res.json(
      roomManager.getPublicRooms()
    );
  }
);

const PORT = 5000;

httpServer.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});