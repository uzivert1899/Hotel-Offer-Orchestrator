import { Connection, WorkflowClient } from "@temporalio/client";

import { env } from "../config/env";

let connectionPromise: Promise<Connection> | undefined;
let temporalClient: WorkflowClient | undefined;

export async function getTemporalClient(): Promise<WorkflowClient> {
  if (temporalClient) {
    return temporalClient;
  }

  connectionPromise ??= Connection.connect({ address: env.TEMPORAL_ADDRESS }).catch((error: unknown) => {
    connectionPromise = undefined;
    throw error;
  });

  const connection = await connectionPromise;
  temporalClient = new WorkflowClient({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
  });

  return temporalClient;
}
