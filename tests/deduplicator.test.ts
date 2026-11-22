import { describe, expect, it } from "vitest";

import type { SupplierHotel } from "../src/types/hotel";
import { deduplicateHotels } from "../src/utils/deduplicator";

describe("deduplicateHotels", () => {
  it("deduplicates overlapping hotels by lowest price", () => {
    const supplierA: SupplierHotel[] = [
      { hotelId: "A1", name: "Holtin", price: 6000, city: "delhi", commissionPct: 10 },
      { hotelId: "A2", name: "Radison", price: 5900, city: "delhi", commissionPct: 8 },
    ];
    const supplierB: SupplierHotel[] = [
      { hotelId: "B1", name: "Holtin", price: 5340, city: "delhi", commissionPct: 12 },
      { hotelId: "B2", name: "Radison", price: 6200, city: "delhi", commissionPct: 9 },
    ];

    expect(deduplicateHotels(supplierA, supplierB)).toEqual([
      { name: "Holtin", price: 5340, supplier: "Supplier B", commissionPct: 12 },
      { name: "Radison", price: 5900, supplier: "Supplier A", commissionPct: 8 },
    ]);
  });

  it("keeps hotels supplied by only one supplier", () => {
    const supplierA: SupplierHotel[] = [
      { hotelId: "A1", name: "Taj Palace", price: 7000, city: "delhi", commissionPct: 10 },
    ];
    const supplierB: SupplierHotel[] = [
      { hotelId: "B1", name: "The Oberoi", price: 8000, city: "delhi", commissionPct: 11 },
    ];

    expect(deduplicateHotels(supplierA, supplierB)).toEqual([
      { name: "Taj Palace", price: 7000, supplier: "Supplier A", commissionPct: 10 },
      { name: "The Oberoi", price: 8000, supplier: "Supplier B", commissionPct: 11 },
    ]);
  });

  it("uses higher commissionPct when prices are identical", () => {
    const supplierA: SupplierHotel[] = [
      { hotelId: "A1", name: "Holtin", price: 5000, city: "delhi", commissionPct: 10 },
    ];
    const supplierB: SupplierHotel[] = [
      { hotelId: "B1", name: "Holtin", price: 5000, city: "delhi", commissionPct: 15 },
    ];

    expect(deduplicateHotels(supplierA, supplierB)).toEqual([
      { name: "Holtin", price: 5000, supplier: "Supplier B", commissionPct: 15 },
    ]);
  });

  it("normalizes names case-insensitively and trims whitespace", () => {
    const supplierA: SupplierHotel[] = [
      { hotelId: "A1", name: "  HoltIn  ", price: 6000, city: "delhi", commissionPct: 10 },
    ];
    const supplierB: SupplierHotel[] = [
      { hotelId: "B1", name: "holtin", price: 5800, city: "delhi", commissionPct: 9 },
    ];

    expect(deduplicateHotels(supplierA, supplierB)).toEqual([
      { name: "holtin", price: 5800, supplier: "Supplier B", commissionPct: 9 },
    ]);
  });

  it("returns an empty array when both supplier lists are empty", () => {
    expect(deduplicateHotels([], [])).toEqual([]);
  });
});
