import { Room } from "./types";

const rooms = new Map<string, Room>();

export const roomManager = {
  createRoom(room: Room) {
    rooms.set(room.id, room);

    return room;
  },

  getRoom(roomId: string) {
    return rooms.get(roomId);
  },

  getPublicRooms() {
    return Array.from(rooms.values())
      .filter((room) => room.isPublic)
      .map((room) => ({
        id: room.id,
        name: room.name,
        playerCount: room.players.length,
        maxPlayers: room.maxPlayers,
      }));
  },

  removeRoom(roomId: string) {
    rooms.delete(roomId);
  },
  findRoomBySocketId(socketId: string) {
    return Array.from(rooms.values()).find((room) =>
      room.players.some((player) => player.socketId === socketId),
    );
  },
  removePlayer(roomId: string, socketId: string) {
    const room = rooms.get(roomId);

    if (!room) return;

    room.players = room.players.filter(
      (player) => player.socketId !== socketId,
    );

    return room;
  },
  deleteRoomIfEmpty(roomId: string) {
    const room = rooms.get(roomId);

    if (room && room.players.length === 0) {
      rooms.delete(roomId);
    }
  },
};

export const getPublicRoomsData = () => {
  return Array.from(rooms.values())
    .filter((room) => room.isPublic)
    .map((room) => ({
      id: room.id,
      name: room.name,
      playerCount: room.players.length,
      maxPlayers: room.maxPlayers,
    }));
};
