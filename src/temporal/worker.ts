import { NativeConnection, Worker } from "@temporalio/worker";

import { env } from "../config/env";
import { logger } from "../utils/logger";
import { activities, closeActivityConnections } from "./activities";

async function runWorker(): Promise<void> {
  const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });
  let worker: Worker | undefined;

  try {
    worker = await Worker.create({
      connection,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowsPath: require.resolve("./workflows"),
      activities,
    });

    const shutdown = (signal: NodeJS.Signals): void => {
      logger.info({ signal }, "Shutting down Temporal worker");
      worker?.shutdown();
    };
    const handleSigint = (): void => shutdown("SIGINT");
    const handleSigterm = (): void => shutdown("SIGTERM");

    process.once("SIGINT", handleSigint);
    process.once("SIGTERM", handleSigterm);

    try {
      await worker.run();
    } finally {
      process.removeListener("SIGINT", handleSigint);
      process.removeListener("SIGTERM", handleSigterm);
    }
  } finally {
    await closeActivityConnections();
    await connection.close();
  }
}

void runWorker().catch((error: unknown) => {
  logger.fatal({ err: error }, "Temporal worker failed");
  process.exitCode = 1;
});
