import Redis from "ioredis";

import { env } from "../config/env";
import { HotelCacheRepository } from "../repositories/hotelCacheRepository";
import { logger } from "../utils/logger";
import type { DeduplicatedHotel, SupplierHotel } from "../types/hotel";

const redisClient = new Redis(env.REDIS_URL, { lazyConnect: true });
const hotelCacheRepo = new HotelCacheRepository({
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

async function fetchSupplierHotels(
  supplier: "A" | "B",
  city: string,
): Promise<SupplierHotel[]> {
  const supplierName = supplier === "A" ? "Supplier A" : "Supplier B";
  const url = `${env.SUPPLIER_BASE_URL}/supplier${supplier}/hotels?city=${encodeURIComponent(city)}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) {
      throw new Error(`${supplierName} request failed with HTTP status ${response.status}`);
    }

    const hotels = (await response.json()) as SupplierHotel[];
    logger.info({ city, supplier: supplierName, hotelCount: hotels.length }, "Fetched supplier hotels");
    return hotels;
  } catch (error) {
    logger.error({ err: error, city, supplier: supplierName }, "Failed to fetch supplier hotels");
    throw error;
  }
}

export async function fetchSupplierAHotels(city: string): Promise<SupplierHotel[]> {
  return fetchSupplierHotels("A", city);
}

export async function fetchSupplierBHotels(city: string): Promise<SupplierHotel[]> {
  return fetchSupplierHotels("B", city);
}

export async function saveDeduplicatedHotels(
  city: string,
  hotels: DeduplicatedHotel[],
): Promise<void> {
  try {
    await hotelCacheRepo.saveCityOffers(city, hotels, env.REDIS_CACHE_TTL_SECONDS);
    logger.info({ city, hotelCount: hotels.length }, "Saved deduplicated hotel offers");
  } catch (error) {
    logger.error({ err: error, city }, "Failed to save deduplicated hotel offers");
    throw error;
  }
}

export async function closeActivityConnections(): Promise<void> {
  redisClient.disconnect();
}

export const activities = {
  fetchSupplierAHotels,
  fetchSupplierBHotels,
  saveDeduplicatedHotels,
};
