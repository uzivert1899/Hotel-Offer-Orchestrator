import { Router, type Request, type Response } from "express";

import { logger } from "../utils/logger";
import { hotelCacheRepo } from "./hotelRoutes";

export const healthRoutes = Router();

healthRoutes.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    const isConnected = await hotelCacheRepo.ping();
    if (isConnected) {
      res.status(200).json({ status: "ok", redis: "connected" });
      return;
    }
  } catch (error) {
    logger.error({ err: error }, "Redis health check failed");
  }

  res.status(503).json({ status: "degraded", redis: "disconnected" });
});

export default healthRoutes;
