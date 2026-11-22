export type SupplierName = "Supplier A" | "Supplier B";

export interface SupplierHotel {
  hotelId: string;
  name: string;
  price: number;
  city: string;
  commissionPct: number;
}

export interface DeduplicatedHotel {
  name: string;
  price: number;
  supplier: SupplierName;
  commissionPct: number;
}

export interface PriceFilter {
  minPrice?: number;
  maxPrice?: number;
}

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  dependencies: {
    supplierA: "up" | "down";
    supplierB: "up" | "down";
    redis: "up" | "down";
    temporal: "up" | "down";
  };
}
