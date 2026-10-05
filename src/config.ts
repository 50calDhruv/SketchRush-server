import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5000),
  /** Comma-separated list of origins allowed to connect, e.g. "https://sketchrush.app". */
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
});

const env = envSchema.parse(process.env);

export const config = {
  port: env.PORT,
  corsOrigins: env.CLIENT_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};
