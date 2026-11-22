import type { Server } from "node:http";

import { app } from "./app";
import { env } from "./config/env";
import { hotelCacheRepo } from "./routes/hotelRoutes";
import { logger } from "./utils/logger";

async function startServer(): Promise<void> {
  await hotelCacheRepo.connect();

  const server: Server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Hotel offer API listening");
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, "Shutting down HTTP server");
    process.removeListener("SIGINT", handleSigint);
    process.removeListener("SIGTERM", handleSigterm);

    server.close((error?: Error) => {
      void finishShutdown(error);
    });
  };
  const handleSigint = (): void => shutdown("SIGINT");
  const handleSigterm = (): void => shutdown("SIGTERM");

  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);
}

async function finishShutdown(error?: Error): Promise<void> {
  if (error) {
    logger.error({ err: error }, "HTTP server shutdown failed");
    process.exitCode = 1;
  }

  try {
    await hotelCacheRepo.disconnect();
  } catch (disconnectError) {
    logger.error({ err: disconnectError }, "Redis shutdown failed");
    process.exitCode = 1;
  }
}

void startServer().catch((error: unknown) => {
  logger.fatal({ err: error }, "HTTP server failed to start");
  process.exitCode = 1;
  void hotelCacheRepo.disconnect().catch((disconnectError: unknown) => {
    logger.error({ err: disconnectError }, "Redis cleanup after startup failure failed");
  });
});
