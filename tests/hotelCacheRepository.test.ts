import { describe, expect, it, vi } from "vitest";

import { HotelCacheRepository } from "../src/repositories/hotelCacheRepository";
import type { DeduplicatedHotel } from "../src/types/hotel";

interface MockRedisOptions {
  members?: string[];
}

function createMockRedis(options: MockRedisOptions = {}): {
  client: ConstructorParameters<typeof HotelCacheRepository>[0];
  zAdd: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  zRangeByScore: ReturnType<typeof vi.fn>;
} {
  const del = vi.fn().mockReturnThis();
  const zAdd = vi.fn().mockReturnThis();
  const expire = vi.fn().mockReturnThis();
  const zRangeByScore = vi.fn().mockResolvedValue(options.members ?? []);
  const exec = vi.fn().mockResolvedValue([]);

  const client = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue("PONG"),
    multi: vi.fn(() => ({
      del,
      zAdd,
      expire,
      exec,
    })),
    zRangeByScore,
  };

  return { client, zAdd, del, expire, zRangeByScore };
}

const offers: DeduplicatedHotel[] = [
  { name: "Holtin", price: 5340, supplier: "Supplier B", commissionPct: 12 },
  { name: "Radison", price: 5900, supplier: "Supplier A", commissionPct: 8 },
  { name: "Taj Palace", price: 7200, supplier: "Supplier A", commissionPct: 10 },
];

describe("HotelCacheRepository", () => {
  it("saves offers with DEL, ZADD, and EXPIRE in one transaction", async () => {
    const mock = createMockRedis();
    const repository = new HotelCacheRepository(mock.client);

    await repository.saveCityOffers(" DELHI ", offers, 300);

    expect(mock.del).toHaveBeenCalledWith("hotels:delhi");
    expect(mock.zAdd).toHaveBeenCalledWith(
      "hotels:delhi",
      offers.map((offer) => ({
        score: offer.price,
        value: JSON.stringify(offer),
      })),
    );
    expect(mock.expire).toHaveBeenCalledWith("hotels:delhi", 300);
  });

  it("filters with a minPrice only", async () => {
    const mock = createMockRedis({ members: [JSON.stringify(offers[2])] });
    const repository = new HotelCacheRepository(mock.client);

    const result = await repository.getFilteredOffers("delhi", { minPrice: 6000 });

    expect(mock.zRangeByScore).toHaveBeenCalledWith("hotels:delhi", 6000, "+inf");
    expect(result).toEqual([offers[2]]);
  });

  it("filters with a maxPrice only", async () => {
    const mock = createMockRedis({ members: [JSON.stringify(offers[0])] });
    const repository = new HotelCacheRepository(mock.client);

    const result = await repository.getFilteredOffers("delhi", { maxPrice: 5500 });

    expect(mock.zRangeByScore).toHaveBeenCalledWith("hotels:delhi", "-inf", 5500);
    expect(result).toEqual([offers[0]]);
  });

  it("filters with both price bounds", async () => {
    const mock = createMockRedis({ members: [JSON.stringify(offers[1])] });
    const repository = new HotelCacheRepository(mock.client);

    const result = await repository.getFilteredOffers("delhi", {
      minPrice: 5500,
      maxPrice: 6500,
    });

    expect(mock.zRangeByScore).toHaveBeenCalledWith("hotels:delhi", 5500, 6500);
    expect(result).toEqual([offers[1]]);
  });

  it("returns an empty array for an empty city result", async () => {
    const mock = createMockRedis();
    const repository = new HotelCacheRepository(mock.client);

    await expect(repository.getFilteredOffers("atlantis", {})).resolves.toEqual([]);
    expect(mock.zRangeByScore).toHaveBeenCalledWith(
      "hotels:atlantis",
      "-inf",
      "+inf",
    );
  });
});
