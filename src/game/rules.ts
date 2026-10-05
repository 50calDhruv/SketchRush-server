import { randomInt } from "node:crypto";

/** Phase durations. Draw time is a per-room setting. */
export const TIMINGS = {
  chooseMs: 15_000,
  turnEndMs: 5_000,
  gameOverMs: 12_000,
  /** How long a disconnected player keeps their seat (covers refreshes and network blips). */
  reconnectGraceMs: 15_000,
} as const;

export const WORD_CHOICE_COUNT = 3;
export const DRAWER_POINTS_PER_GUESS = 50;
const MIN_GUESS_POINTS = 50;
const MAX_GUESS_POINTS = 300;

/** Lowercase, strip accents and punctuation, drop whitespace — "Ice-Cream " matches "ice cream". */
export const normalize = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export const levenshtein = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
};

export type GuessResult = "correct" | "close" | "wrong";

export const evaluateGuess = (guess: string, word: string): GuessResult => {
  const g = normalize(guess);
  const w = normalize(word);
  if (!g) return "wrong";
  if (g === w) return "correct";
  // Only hint "close" on longer words, otherwise a single typo gives too much away.
  if (w.length >= 4 && levenshtein(g, w) === 1) return "close";
  return "wrong";
};

/** Faster guesses earn more: linear from MAX at the start down to MIN at the buzzer. */
export const guesserPoints = (remainingMs: number, totalMs: number): number => {
  const fraction = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;
  return Math.round(MIN_GUESS_POINTS + (MAX_GUESS_POINTS - MIN_GUESS_POINTS) * fraction);
};

export type HintReveal = { atMs: number; index: number };

/**
 * Letters to reveal over the drawing phase: up to a third of the letters (max 3), spread across
 * the second half of the turn so early guessers still have to work for it.
 */
export const hintSchedule = (word: string, drawMs: number): HintReveal[] => {
  const letterIndices = [...word].flatMap((char, i) => (char === " " ? [] : [i]));
  const count = Math.min(3, Math.floor(letterIndices.length / 3));
  const reveals: HintReveal[] = [];
  for (let n = 0; n < count; n++) {
    const index = letterIndices.splice(randomInt(letterIndices.length), 1)[0];
    if (index === undefined) break;
    reveals.push({ atMs: Math.round(drawMs * (0.5 + (0.4 * n) / count)), index });
  }
  return reveals;
};

/** Spaces are always visible; other characters show only once revealed. */
export const maskWord = (word: string, revealed: ReadonlySet<number>): (string | null)[] =>
  [...word].map((char, i) => (char === " " || revealed.has(i) ? char : null));
