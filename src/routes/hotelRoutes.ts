import { WorkflowFailedError } from "@temporalio/client";
import { Router, type NextFunction, type Request, type Response } from "express";
import Redis from "ioredis";
import { z } from "zod";

import { env } from "../config/env";
import { HotelCacheRepository } from "../repositories/hotelCacheRepository";
import type { PriceFilter } from "../types/hotel";
import { getTemporalClient } from "../temporal/client";
import { orchestrateHotelOffers } from "../temporal/workflows";

const redisClient = new Redis(env.REDIS_URL, { lazyConnect: true });

export const hotelCacheRepo = new HotelCacheRepository({
  connect: async () => {
    if (redisClient.status === "wait") {
      await redisClient.connect();
    }
  },
  disconnect: async () => {
    redisClient.disconnect();
  },
  ping: () => redisClient.ping(),
  multi: () => {
    const transaction = redisClient.multi();
    const multi = {
      del(key: string) {
        transaction.del(key);
        return multi;
      },
      zAdd(key: string, members: Array<{ score: number; value: string }>) {
        for (const member of members) {
          transaction.zadd(key, member.score, member.value);
        }
        return multi;
      },
      expire(key: string, seconds: number) {
        transaction.expire(key, seconds);
        return multi;
      },
      async exec(): Promise<unknown> {
        const results = await transaction.exec();
        const failedCommand = results?.find(([error]) => error !== null);
        if (failedCommand?.[0]) {
          throw failedCommand[0];
        }
        return results;
      },
    };
    return multi;
  },
  zRangeByScore: (key: string, min: number | string, max: number | string) =>
    redisClient.zrangebyscore(key, min, max),
});

const optionalPrice = z.preprocess(
  (value: unknown) => {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== "string" || value.trim() === "") {
      return Number.NaN;
    }
    return Number(value);
  },
  z.number().finite().min(0).optional(),
);

const hotelQuerySchema = z
  .object({
    city: z.string().trim().min(1),
    minPrice: optionalPrice,
    maxPrice: optionalPrice,
  })
  .refine(
    ({ minPrice, maxPrice }) =>
      minPrice === undefined || maxPrice === undefined || minPrice <= maxPrice,
    {
      message: "minPrice must be less than or equal to maxPrice",
      path: ["maxPrice"],
    },
  );

export const hotelRoutes = Router();

hotelRoutes.get(
  "/hotels",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = hotelQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
      return;
    }

    const { city, minPrice, maxPrice } = parsed.data;
    const filter: PriceFilter = {};
    if (minPrice !== undefined) {
      filter.minPrice = minPrice;
    }
    if (maxPrice !== undefined) {
      filter.maxPrice = maxPrice;
    }

    try {
      const client = await getTemporalClient();
      await client.execute(orchestrateHotelOffers, {
        taskQueue: env.TEMPORAL_TASK_QUEUE,
        workflowId: `hotel-search-${city}-${Date.now()}`,
        args: [city],
      });

      const results = await hotelCacheRepo.getFilteredOffers(city, filter);
      res.status(200).json(results);
    } catch (error) {
      if (error instanceof WorkflowFailedError) {
        res.status(502).json({ error: "Upstream suppliers unavailable" });
        return;
      }
      next(error);
    }
  },
);

export default hotelRoutes;
