import type { DeduplicatedHotel, PriceFilter } from "../types/hotel";

interface RedisMulti {
  del(key: string): RedisMulti;
  zAdd(
    key: string,
    members: Array<{ score: number; value: string }>,
  ): RedisMulti;
  expire(key: string, seconds: number): RedisMulti;
  exec(): Promise<unknown>;
}

interface RedisClientType {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ping(): Promise<string>;
  multi(): RedisMulti;
  zRangeByScore(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<string[]>;
}

export class HotelCacheRepository {
  constructor(private readonly client: RedisClientType) {}

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  async ping(): Promise<boolean> {
    const response = await this.client.ping();
    return response === "PONG";
  }

  async saveCityOffers(
    city: string,
    offers: DeduplicatedHotel[],
    ttlSeconds: number = 300,
  ): Promise<void> {
    const key = `hotels:${city.trim().toLowerCase()}`;
    const multi = this.client.multi();

    multi.del(key);

    if (offers.length > 0) {
      multi.zAdd(
        key,
        offers.map((offer) => ({
          score: offer.price,
          value: JSON.stringify(offer),
        })),
      );
      multi.expire(key, ttlSeconds);
    }

    await multi.exec();
  }

  async getFilteredOffers(
    city: string,
    filter: PriceFilter,
  ): Promise<DeduplicatedHotel[]> {
    const key = `hotels:${city.trim().toLowerCase()}`;
    const min = filter.minPrice ?? "-inf";
    const max = filter.maxPrice ?? "+inf";
    const rawMembers = await this.client.zRangeByScore(key, min, max);

    return rawMembers.map((raw) => JSON.parse(raw) as DeduplicatedHotel);
  }
}
