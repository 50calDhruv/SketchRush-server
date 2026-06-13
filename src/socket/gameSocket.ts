import { Server, Socket } from "socket.io";
import { EVENTS } from "../constants/events";
import { roomManager } from "../game/roomManager";
import { generateRoomId } from "../game/generateRoomId";
import { Room } from "../game/types";
import { startGame } from "../game/startGame";

export const registerGameSocket = (io: Server, socket: Socket) => {
  console.log("Connected:", socket.id);

  socket.on(EVENTS.START_GAME, ({ roomId }) => {
    const room = roomManager.getRoom(roomId);

    if (!room) return;

    if (room.players.length < 2) {
      socket.emit(EVENTS.ERROR, "Need at least 2 players");

      return;
    }

    startGame(room);

    io.to(roomId).emit(EVENTS.ROOM_STATE, room);
  });

  socket.on(EVENTS.JOIN_ROOM, ({ roomId, username }) => {
    const room = roomManager.getRoom(roomId);

    if (!room) {
      socket.emit(EVENTS.ERROR, "Room not found");

      return;
    }

    if (room.players.length >= room.maxPlayers) {
      socket.emit(EVENTS.ERROR, "Room is full");

      return;
    }

    const alreadyJoined = room.players.some(
      (player) => player.socketId === socket.id,
    );

    if (!alreadyJoined) {
      room.players.push({
        socketId: socket.id,
        username,
        score: 0,
      });
    }

    socket.join(roomId);

    broadcastPublicRooms(io);

    io.to(roomId).emit(EVENTS.ROOM_STATE, room);
  });

  socket.on(EVENTS.CREATE_ROOM, ({ username, roomName, isPublic }) => {
    const roomId = generateRoomId();

    const room: Room = {
      id: roomId,
      name: roomName,
      isPublic,

      ownerId: socket.id,

      maxPlayers: 6,

      players: [
        {
          socketId: socket.id,
          username,
          score: 0,
        },
      ],
      gameState: {
        status: "waiting",
        currentDrawerIndex: 0,
        currentWord: "",
        round: 0,
        maxRounds: 3,
        timeLeft: 0,
      },
    };

    roomManager.createRoom(room);

    broadcastPublicRooms(io);

    socket.join(roomId);

    socket.emit(EVENTS.ROOM_CREATED, {
      roomId,
    });

    io.to(roomId).emit(EVENTS.ROOM_STATE, room);
  });

  socket.on(EVENTS.GET_PUBLIC_ROOMS, () => {
    socket.emit(EVENTS.PUBLIC_ROOMS, roomManager.getPublicRooms());
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);

    const room = roomManager.findRoomBySocketId(socket.id);

    if (!room) return;

    const updatedRoom = roomManager.removePlayer(room.id, socket.id);

    if (updatedRoom) io.to(room.id).emit(EVENTS.ROOM_STATE, updatedRoom);

    roomManager.deleteRoomIfEmpty(room.id);

    broadcastPublicRooms(io);
  });
};

const broadcastPublicRooms = (io: Server) => {
  io.emit(EVENTS.PUBLIC_ROOMS, roomManager.getPublicRooms());
};
