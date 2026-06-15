import { Room } from "./types";
import { WORDS } from "./words";

export const startRound = (
  room: Room
) => {

  const word =
    WORDS[
      Math.floor(
        Math.random() *
          WORDS.length
      )
    ];

  room.gameState.currentWord =
    word;

  room.gameState.timeLeft = 60;

  return room;
};