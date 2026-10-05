import { config } from "./config.js";
import { createGameServer } from "./server.js";

const { httpServer, close } = createGameServer({ corsOrigins: config.corsOrigins });

httpServer.listen(config.port, () => {
  console.log(`SketchRush server listening on http://localhost:${config.port}`);
});

const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down`);
  close().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error("Shutdown failed", error);
      process.exit(1);
    },
  );
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
