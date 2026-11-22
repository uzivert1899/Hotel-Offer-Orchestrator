import type { DeduplicatedHotel, SupplierHotel, SupplierName } from "../types/hotel";

export function deduplicateHotels(
  supplierAList: SupplierHotel[],
  supplierBList: SupplierHotel[],
): DeduplicatedHotel[] {
  const hotels = new Map<string, DeduplicatedHotel>();

  const taggedItems: Array<SupplierHotel & { supplier: SupplierName }> = [
    ...supplierAList.map((item) => ({ ...item, supplier: "Supplier A" as const })),
    ...supplierBList.map((item) => ({ ...item, supplier: "Supplier B" as const })),
  ];

  for (const item of taggedItems) {
    const key = item.name.trim().toLowerCase();
    const existing = hotels.get(key);

    if (!existing) {
      hotels.set(key, {
        name: item.name.trim(),
        price: item.price,
        supplier: item.supplier,
        commissionPct: item.commissionPct,
      });
      continue;
    }

    if (
      item.price < existing.price ||
      (item.price === existing.price && item.commissionPct > existing.commissionPct)
    ) {
      hotels.set(key, {
        name: item.name.trim(),
        price: item.price,
        supplier: item.supplier,
        commissionPct: item.commissionPct,
      });
    }
  }

  return Array.from(hotels.values()).sort((a, b) => a.price - b.price);
}
