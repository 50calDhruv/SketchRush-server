import { Room } from "./types";
import { WORDS } from "./words";

export const startGame = (
  room: Room
) => {

  const randomWord =
    WORDS[
      Math.floor(
        Math.random() *
          WORDS.length
      )
    ];

  room.gameState = {
    status: "playing",

    currentDrawerIndex: 0,

    currentWord:
      randomWord,

    round: 1,

    maxRounds: 3,

    timeLeft: 60,
  };

  return room;
};