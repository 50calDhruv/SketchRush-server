import { z } from "zod";

import { WORD_CHOICE_COUNT } from "../game/rules.js";
import { BRUSH_SIZES, LIMITS, SETTINGS_BOUNDS } from "../shared/protocol.js";

// Every client payload is untrusted. These schemas are the boundary.

const hasNoControlChars = (value: string) => !/\p{Cc}/u.test(value);

const displayName = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.nameMaxLength)
  .refine(hasNoControlChars);

export const handshakeSchema = z.object({
  sessionId: z.string().regex(/^[\w-]{16,64}$/),
});

export const createRoomSchema = z.object({ name: displayName });

export const joinRoomSchema = z.object({
  name: displayName,
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(new RegExp(`^[A-Z0-9]{${LIMITS.roomCodeLength}}$`)),
});

const { rounds, drawTime, maxPlayers } = SETTINGS_BOUNDS;
export const settingsSchema = z
  .object({
    rounds: z.int().min(rounds.min).max(rounds.max),
    drawTime: z.int().min(drawTime.min).max(drawTime.max).multipleOf(drawTime.step),
    maxPlayers: z.int().min(maxPlayers.min).max(maxPlayers.max),
    isPublic: z.boolean(),
  })
  .partial()
  .strict();

export const chooseWordSchema = z.object({
  index: z.int().min(0).max(WORD_CHOICE_COUNT - 1),
});

export const chatSchema = z.object({
  text: z.string().trim().min(1).max(LIMITS.chatMaxLength).refine(hasNoControlChars),
});

export const strokeSegmentSchema = z.object({
  id: z.string().regex(/^[\w-]{1,32}$/),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  size: z.number().refine((size) => (BRUSH_SIZES as readonly number[]).includes(size)),
  points: z
    .array(z.number().min(0).max(1))
    .min(2)
    .max(LIMITS.pointsPerMessage)
    .refine((points) => points.length % 2 === 0, "points must be x,y pairs"),
});
