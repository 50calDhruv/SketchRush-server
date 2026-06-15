import { Server } from "socket.io";

import { Room } from "./types";

import { EVENTS } from "../constants/events";

const roomTimers = new Map<string, NodeJS.Timeout>();

export const startTimer = (io: Server, room: Room) => {
  stopTimer(room.id);

  const interval = setInterval(() => {
    room.gameState.timeLeft--;

    io.to(room.id).emit(EVENTS.ROOM_STATE, room);

    if (room.gameState.timeLeft <= 0) {
      stopTimer(room.id);

      io.to(room.id).emit(EVENTS.ROUND_ENDED);
    }
  }, 1000);

  roomTimers.set(room.id, interval);
};

export const stopTimer = (roomId: string) => {
  const timer = roomTimers.get(roomId);

  if (timer) {
    clearInterval(timer);

    roomTimers.delete(roomId);
  }
};