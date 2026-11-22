import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { env } from "../config/env";
import { SUPPLIER_A_HOTELS, SUPPLIER_B_HOTELS } from "./mockData";

const supplierStatusSchema = z.object({
  down: z.boolean(),
});

let supplierADown = env.SUPPLIER_A_DOWN;
let supplierBDown = env.SUPPLIER_B_DOWN;

export const supplierRoutes = Router();

supplierRoutes.get("/supplierA/hotels", (req: Request, res: Response): void => {
  if (supplierADown) {
    res.status(503).json({ error: "Supplier A unavailable" });
    return;
  }

  const city = String(req.query.city || "").trim().toLowerCase();
  const matches = SUPPLIER_A_HOTELS.filter(
    (hotel) => hotel.city.toLowerCase() === city,
  );
  res.status(200).json(matches);
});

supplierRoutes.get("/supplierB/hotels", (req: Request, res: Response): void => {
  if (supplierBDown) {
    res.status(503).json({ error: "Supplier B unavailable" });
    return;
  }

  const city = String(req.query.city || "").trim().toLowerCase();
  const matches = SUPPLIER_B_HOTELS.filter(
    (hotel) => hotel.city.toLowerCase() === city,
  );
  res.status(200).json(matches);
});

supplierRoutes.post("/mock/suppliers/:supplier/status", (req: Request, res: Response): void => {
  const supplier = req.params.supplier;
  const parsed = supplierStatusSchema.safeParse(req.body);

  if (supplier !== "A" && supplier !== "B") {
    res.status(400).json({ error: "Supplier must be A or B" });
    return;
  }

  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  if (supplier === "A") {
    supplierADown = parsed.data.down;
  } else {
    supplierBDown = parsed.data.down;
  }

  res.status(200).json({ supplier, down: parsed.data.down });
});

export default supplierRoutes;
