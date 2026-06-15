import { Room } from "./types";

export const nextDrawer = (room: Room) => {
  room.gameState.currentDrawerIndex =
    (room.gameState.currentDrawerIndex + 1) % room.players.length;

  return room;
};