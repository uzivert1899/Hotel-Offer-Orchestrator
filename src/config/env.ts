import { z } from "zod";

export interface EnvConfig {
  NODE_ENV: "development" | "production" | "test";
  PORT: number;
  LOG_LEVEL: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  SUPPLIER_BASE_URL: string;
  REDIS_URL: string;
  REDIS_CACHE_TTL_SECONDS: number;
  TEMPORAL_ADDRESS: string;
  TEMPORAL_NAMESPACE: string;
  TEMPORAL_TASK_QUEUE: string;
  SUPPLIER_A_DOWN: boolean;
  SUPPLIER_B_DOWN: boolean;
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SUPPLIER_BASE_URL: z.string().url().default("http://localhost:3000"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  REDIS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  TEMPORAL_ADDRESS: z.string().min(1).default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().min(1).default("default"),
  TEMPORAL_TASK_QUEUE: z.string().min(1).default("hotel-offer-orchestration"),
  SUPPLIER_A_DOWN: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  SUPPLIER_B_DOWN: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
});

export const env: EnvConfig = envSchema.parse(process.env);
