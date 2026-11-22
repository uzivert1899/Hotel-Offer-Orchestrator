import { ApplicationFailure, proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities";
import { deduplicateHotels } from "../utils/deduplicator";
import type { DeduplicatedHotel } from "../types/hotel";

const {
  fetchSupplierAHotels,
  fetchSupplierBHotels,
  saveDeduplicatedHotels,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 seconds",
  retry: {
    maximumAttempts: 2,
    initialInterval: "500ms",
  },
});

export async function orchestrateHotelOffers(
  city: string,
): Promise<DeduplicatedHotel[]> {
  const [resA, resB] = await Promise.allSettled([
    fetchSupplierAHotels(city),
    fetchSupplierBHotels(city),
  ]);

  if (resA.status === "rejected" && resB.status === "rejected") {
    throw ApplicationFailure.nonRetryable("All hotel suppliers are unavailable");
  }

  const listA = resA.status === "fulfilled" ? resA.value : [];
  const listB = resB.status === "fulfilled" ? resB.value : [];
  const deduplicated = deduplicateHotels(listA, listB);

  await saveDeduplicatedHotels(city, deduplicated);
  return deduplicated;
}
