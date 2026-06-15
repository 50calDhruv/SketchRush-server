export interface Player {
  socketId: string;
  username: string;
  score: number;
}

export interface Room {
  id: string;
  name: string;
  isPublic: boolean;
  ownerId: string;
  maxPlayers: number;
  players: Player[];
  gameState: GameState;
}

interface GameState {
  status: "waiting" | "playing";
  currentDrawerIndex: number;
  currentWord: string;
  round: number;
  maxRounds: number;
  timeLeft: number;
}

export interface ChatMessage {
  username: string;
  text: string;
  timestamp: number;
}