import express, { type ErrorRequestHandler } from "express";
import pinoHttp from "pino-http";

import { healthRoutes } from "./routes/healthRoutes";
import { hotelRoutes } from "./routes/hotelRoutes";
import { supplierRoutes } from "./suppliers/supplierRoutes";
import { logger } from "./utils/logger";

export const app = express();

app.use(pinoHttp({ logger }));
app.use(express.json());

app.use("/", supplierRoutes);
app.use("/api", hotelRoutes);
app.use("/health", healthRoutes);

const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next): void => {
  if (
    error instanceof SyntaxError &&
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.parse.failed"
  ) {
    res.status(400).json({ error: "Invalid JSON request body" });
    return;
  }

  logger.error({ err: error }, "Unhandled request error");
  res.status(500).json({ error: "Internal server error" });
};

app.use(errorHandler);
