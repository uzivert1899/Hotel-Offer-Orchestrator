# SPEC.md — Hotel Offer Orchestrator

## 1. System Overview & Core Constraints

- **Objective**: Build a backend service in Node.js (TypeScript) and Express that uses **Temporal.io** to query two internal mock hotel suppliers in parallel, deduplicates hotels by name (retaining the lowest price), persists the deduplicated list in **Redis**, and filters results by numeric price range **inside Redis**.
- **Hard Constraints**:
  1. Stack must strictly use Node.js (TypeScript), Express, Temporal.io, Redis, and Docker Compose.
  2. Price filtering (`minPrice`, `maxPrice`) **must** be executed natively inside Redis using a Sorted Set (`ZRANGE ... BYSCORE` / `ZRANGEBYSCORE`), never by filtering arrays in Node.js memory.
  3. Temporal Workflows must remain 100% deterministic (all HTTP calls, Redis writes, and logging side effects must reside in Temporal Activities).

---

## 2. Exact Folder & File Structure

- `SPEC.md` — Architectural specification & source of truth
- `package.json` — Dependencies, scripts, and TypeScript toolchain
- `tsconfig.json` — Strict TypeScript compiler configuration
- `.env.example` — Environment variable template
- `.gitignore` — Ignore `node_modules`, `dist`, `.env`
- `Dockerfile` — Multi-stage production build for API & Worker
- `docker-compose.yml` — Orchestrates API, Temporal Worker, Temporal Server, and Redis
- `README.md` — Setup, local run, Docker deployment, and API documentation
- `postman/hotel-offer-orchestrator.postman_collection.json` — End-to-end API & fault-tolerance test suite
- `src/config/env.ts` — Zod-validated environment configuration loader
- `src/types/hotel.ts` — Canonical TypeScript interfaces and API response types
- `src/utils/logger.ts` — Structured Pino JSON logger instance
- `src/utils/deduplicator.ts` — Pure deterministic hotel merge, price comparison & tie-break logic
- `src/suppliers/mockData.ts` — Static overlapping hotel datasets for Supplier A and Supplier B
- `src/suppliers/supplierRoutes.ts` — Express router for `/supplierA/hotels`, `/supplierB/hotels` & fault toggle
- `src/repositories/hotelCacheRepository.ts` — Redis Sorted Set (ZSET) persistence and server-side score range queries
- `src/temporal/client.ts` — Singleton Temporal Connection & WorkflowClient factory
- `src/temporal/activities.ts` — Temporal Activities for parallel supplier HTTP fetches & Redis writes
- `src/temporal/workflows.ts` — Deterministic Temporal Workflow orchestrating parallel fetches & dedupe
- `src/temporal/worker.ts` — Standalone Temporal Worker process entrypoint
- `src/api/hotelRoutes.ts` — Express router for `GET /api/hotels` (validation, workflow trigger, Redis read)
- `src/api/healthRoutes.ts` — Express router for `GET /health` checking Suppliers A/B, Redis & Temporal
- `src/app.ts` — Express application setup, middleware, routes, and global error handler
- `src/server.ts` — HTTP server startup and graceful shutdown entrypoint
- `tests/deduplicator.test.ts` — Unit tests for price deduplication, tie-breaking & edge cases
- `tests/hotelCacheRepository.test.ts` — Integration tests for Redis ZSET storage & BYSCORE price filtering

---

## 3. Exact `package.json` & Dependencies

```json
{
  "name": "hotel-offer-orchestrator",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "start:worker": "node dist/temporal/worker.js",
    "dev": "tsx watch src/server.ts",
    "dev:worker": "tsx watch src/temporal/worker.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@temporalio/activity": "^1.11.6",
    "@temporalio/client": "^1.11.6",
    "@temporalio/common": "^1.11.6",
    "@temporalio/worker": "^1.11.6",
    "@temporalio/workflow": "^1.11.6",
    "express": "^4.21.1",
    "pino": "^9.5.0",
    "redis": "^4.7.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.9.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

### `tsconfig.json` Requirements

- `"target": "ES2022"`, `"module": "CommonJS"`, `"moduleResolution": "node"`, `"rootDir": "src"`, `"outDir": "dist"`, `"strict": true`, `"esModuleInterop": true`, `"skipLibCheck": true`, `"forceConsistentCasingInFileNames": true`.
- Include `"src/**/*"` only (exclude `"tests"` from `dist` build).

---

## 4. Environment Variables (`.env.example`)

```env
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Internal base URL used by Temporal Worker to call mock supplier endpoints
SUPPLIER_BASE_URL=http://localhost:3000

# Redis Connection
REDIS_URL=redis://localhost:6379
REDIS_CACHE_TTL_SECONDS=300

# Temporal Configuration
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TASK_QUEUE=hotel-offer-orchestration

# Fault Injection Flags (Optional simulation)
SUPPLIER_A_DOWN=false
SUPPLIER_B_DOWN=false
```

---

## 5. Module-by-Module Technical Specification

### 5.1 `src/config/env.ts`

- **Responsibility**: Parse and validate `process.env` using `zod`. Fail fast on startup if invalid.
- **Exports**:
  - `export interface EnvConfig`
  - `export const env: EnvConfig`
- **Logic**:
  - `NODE_ENV`: enum `['development', 'production', 'test']` defaulting to `'development'`.
  - `PORT`: coerced positive integer defaulting to `3000`.
  - `LOG_LEVEL`: enum `['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']` defaulting to `'info'`.
  - `SUPPLIER_BASE_URL`: URL string defaulting to `'http://localhost:3000'`.
  - `REDIS_URL`: non-empty string defaulting to `'redis://localhost:6379'`.
  - `REDIS_CACHE_TTL_SECONDS`: coerced positive integer defaulting to `300`.
  - `TEMPORAL_ADDRESS`: non-empty string defaulting to `'localhost:7233'`.
  - `TEMPORAL_NAMESPACE`: non-empty string defaulting to `'default'`.
  - `TEMPORAL_TASK_QUEUE`: non-empty string defaulting to `'hotel-offer-orchestration'`.
  - `SUPPLIER_A_DOWN` & `SUPPLIER_B_DOWN`: string `'true'`/`'false'` transformed into `boolean`, defaulting to `false`.

### 5.2 `src/types/hotel.ts`

- **Responsibility**: Define all domain schemas and DTOs.
- **Exact Interfaces**:

  ```typescript
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
  ```

### 5.3 `src/utils/logger.ts`

- **Responsibility**: Export a configured Pino logger.
- **Exports**: `export const logger: pino.Logger`
- **Logic**: Initialize `pino({ level: env.LOG_LEVEL })`. Never log secrets.

### 5.4 `src/utils/deduplicator.ts`

- **Responsibility**: Pure, deterministic deduplication and price comparison logic (safe for Temporal Workflow sandbox).
- **Signature**:
  ```typescript
  export function deduplicateHotels(
    supplierAList: SupplierHotel[],
    supplierBList: SupplierHotel[],
  ): DeduplicatedHotel[];
  ```
- **Step-by-Step Logic**:
  1. Create a `Map<string, DeduplicatedHotel>()` keyed by normalized hotel name: `hotel.name.trim().toLowerCase()`.
  2. Tag each item from `supplierAList` with `supplier: 'Supplier A'` and each item from `supplierBList` with `supplier: 'Supplier B'`.
  3. Iterate through all tagged items:
     - If key is not in map, insert `{ name: item.name.trim(), price: item.price, supplier: item.supplier, commissionPct: item.commissionPct }`.
     - If key exists in map (`existing`):
       - If `item.price < existing.price`, replace with `item`.
       - If `item.price === existing.price` and `item.commissionPct > existing.commissionPct`, replace with `item` (tie-break in favor of higher commission).
       - Otherwise keep `existing`.
  4. Return `Array.from(map.values()).sort((a, b) => a.price - b.price)`.

### 5.5 `src/suppliers/mockData.ts` & `src/suppliers/supplierRoutes.ts`

- **Responsibility**: Serve mock supplier hotel lists and allow runtime simulation of supplier downtime.
- **Data Requirements (`mockData.ts`)**:
  - Must include overlapping hotels for `city: "delhi"` (e.g., `"Holtin"` at `6000` in Supplier A vs `5340` in Supplier B; `"Radison"` at `5900` in Supplier A vs `6200` in Supplier B), plus unique hotels per supplier (`"Taj Palace"` only in A, `"The Oberoi"` only in B), plus another city (e.g., `"mumbai"`).
- **Endpoints (`supplierRoutes.ts`)**:
  - `GET /supplierA/hotels?city=<city>`:
    - If Supplier A is marked down (via `env.SUPPLIER_A_DOWN` or runtime toggle), return HTTP `503` `{ error: "Supplier A unavailable" }`.
    - Filter `SUPPLIER_A_HOTELS` where `h.city.toLowerCase() === String(req.query.city || '').trim().toLowerCase()`. Return `200` JSON array (`[]` if no match).
  - `GET /supplierB/hotels?city=<city>`: Same behavior for Supplier B.
  - `POST /mock/suppliers/:supplier/status` (Body: `{ "down": boolean }`): Runtime toggle (`supplier` is `A` or `B`) so Postman tests can simulate a supplier outage without restarting containers.

### 5.6 `src/repositories/hotelCacheRepository.ts`

- **Responsibility**: Store deduplicated hotel offers in Redis Sorted Sets and execute price filtering **inside Redis**.
- **Class & Signatures**:
  ```typescript
  export class HotelCacheRepository {
    constructor(private readonly client: RedisClientType) {}
    async connect(): Promise<void>;
    async disconnect(): Promise<void>;
    async ping(): Promise<boolean>;
    async saveCityOffers(
      city: string,
      offers: DeduplicatedHotel[],
      ttlSeconds?: number,
    ): Promise<void>;
    async getFilteredOffers(
      city: string,
      filter: PriceFilter,
    ): Promise<DeduplicatedHotel[]>;
  }
  ```
- **Step-by-Step Redis Logic**:
  - **Key Format**: `hotels:${city.trim().toLowerCase()}`
  - **`saveCityOffers`**:
    1. Start a Redis `MULTI` pipeline (`const multi = this.client.multi()`).
    2. `multi.del(key)` to clear stale offers for that city.
    3. If `offers.length > 0`:
       - Call `multi.zAdd(key, offers.map(o => ({ score: o.price, value: JSON.stringify(o) })))`.
       - Call `multi.expire(key, ttlSeconds)`.
    4. Execute `await multi.exec()`.
  - **`getFilteredOffers`**:
    1. Compute bounds: `const min = filter.minPrice ?? '-inf';` and `const max = filter.maxPrice ?? '+inf';`.
    2. Execute `const rawMembers = await this.client.zRangeByScore(key, min, max);`.
    3. Map `rawMembers.map((raw) => JSON.parse(raw) as DeduplicatedHotel)` and return.

### 5.7 `src/temporal/activities.ts`

- **Responsibility**: Execute non-deterministic I/O (HTTP calls to mock suppliers and Redis persistence).
- **Signatures**:
  ```typescript
  export async function fetchSupplierAHotels(
    city: string,
  ): Promise<SupplierHotel[]>;
  export async function fetchSupplierBHotels(
    city: string,
  ): Promise<SupplierHotel[]>;
  export async function saveDeduplicatedHotels(
    city: string,
    hotels: DeduplicatedHotel[],
  ): Promise<void>;
  ```
- **Logic**:
  - Use `fetch` with `AbortSignal.timeout(3000)` to call `${env.SUPPLIER_BASE_URL}/supplierA/hotels?city=${encodeURIComponent(city)}` (and `/supplierB/hotels`).
  - If `!response.ok`, throw an `Error` with HTTP status so Temporal records the failure.
  - `saveDeduplicatedHotels` instantiates/uses the shared `HotelCacheRepository` and calls `saveCityOffers(city, hotels, env.REDIS_CACHE_TTL_SECONDS)`.

### 5.8 `src/temporal/workflows.ts`

- **Responsibility**: Deterministic Temporal workflow orchestrating parallel supplier fetches and deduplication.
- **Signature**:
  ```typescript
  export async function orchestrateHotelOffers(
    city: string,
  ): Promise<DeduplicatedHotel[]>;
  ```
- **Step-by-Step Logic**:
  1. Proxy activities with `startToCloseTimeout: '5 seconds'` and `retry: { maximumAttempts: 2, initialInterval: '500ms' }`.
  2. Execute `const [resA, resB] = await Promise.allSettled([fetchSupplierAHotels(city), fetchSupplierBHotels(city)]);`.
  3. If BOTH `resA.status === 'rejected'` and `resB.status === 'rejected'`, throw `ApplicationFailure.nonRetryable('All hotel suppliers are unavailable')`.
  4. Extract `listA = resA.status === 'fulfilled' ? resA.value : []` and `listB = resB.status === 'fulfilled' ? resB.value : []`.
  5. Compute `const deduplicated = deduplicateHotels(listA, listB);`.
  6. Call `await saveDeduplicatedHotels(city, deduplicated);`.
  7. Return `deduplicated`.

### 5.9 `src/temporal/client.ts` & `src/temporal/worker.ts`

- **`client.ts`**: Exports `getTemporalClient(): Promise<WorkflowClient>` managing a cached `Connection` to `env.TEMPORAL_ADDRESS`.
- **`worker.ts`**: Connects `NativeConnection` to `env.TEMPORAL_ADDRESS`, registers `workflowsPath: require.resolve('./workflows')` and `activities`, listens on `env.TEMPORAL_TASK_QUEUE`, and handles `SIGINT`/`SIGTERM` graceful shutdown.

### 5.10 `src/api/hotelRoutes.ts` & `src/api/healthRoutes.ts`

- **`GET /api/hotels`**:
  1. Validate query params with Zod:
     - `city`: non-empty trimmed string (required -> `400` if missing/blank).
     - `minPrice`: optional finite number `>= 0` (`400` if `NaN` or `< 0`).
     - `maxPrice`: optional finite number `>= 0` (`400` if `NaN` or `< 0`).
     - Refine: if both `minPrice` and `maxPrice` exist, enforce `minPrice <= maxPrice` (`400` otherwise).
  2. Trigger Temporal workflow:
     ```typescript
     const client = await getTemporalClient();
     await client.execute(orchestrateHotelOffers, {
       taskQueue: env.TEMPORAL_TASK_QUEUE,
       workflowId: `hotel-search-${normalizedCity}-${Date.now()}`,
       args: [normalizedCity],
     });
     ```
  3. Query filtered results directly from Redis:
     `const results = await hotelCacheRepo.getFilteredOffers(normalizedCity, { minPrice, maxPrice });`
  4. Return HTTP `200` with `results` JSON array.
  5. Catch Temporal `WorkflowFailedError` -> return HTTP `502` `{ error: "Upstream suppliers unavailable" }`.
- **`GET /health`**:
  - Concurrently check Supplier A (`/supplierA/hotels?city=healthcheck`), Supplier B (`/supplierB/hotels?city=healthcheck`), Redis (`hotelCacheRepo.ping()`), and Temporal connection.
  - Return `200` if all dependencies are `'up'`, `200` with `status: 'degraded'` if one supplier is `'down'` but Redis & Temporal are `'up'`, and `503` with `status: 'unhealthy'` if Redis, Temporal, or both suppliers are `'down'`.

---

## 6. Edge Cases & Validation Rules

- **Missing or empty `city` (`GET /api/hotels`)**: Return HTTP `400` with `{ error: "Validation failed", details: ... }`.
- **Non-numeric or negative price (`?minPrice=abc` or `?minPrice=-10`)**: Return HTTP `400`.
- **Inverted price bounds (`?minPrice=7000&maxPrice=5000`)**: Return HTTP `400`.
- **Single-bound price query (`?minPrice=5500` or `?maxPrice=6000`)**: Supported via `-inf` / `+inf` in Redis `ZRANGEBYSCORE`.
- **Unknown city (`?city=atlantis`)**: Workflow completes with `[]`, Redis clears/skips key, endpoint returns HTTP `200` `[]`.
- **Case-insensitive matching**: `?city=DELHI` and `?city=delhi` map to the same normalized city key (`hotels:delhi`), and `"Holtin"` vs `"holtin "` deduplicate cleanly.
- **One supplier down**: Workflow logs failure in activity, retains healthy supplier results, writes to Redis, and serves HTTP `200`.

---

## 7. Coding Conventions & Docker Architecture

- **Strict TypeScript**: No `any` types; explicit return types on all exported functions.
- **Docker Compose Services (`docker-compose.yml`)**:
  1. `redis`: `redis:7-alpine` with `redis-cli ping` healthcheck.
  2. `temporal`: `temporalio/temporal:latest` running `server start-dev --ip 0.0.0.0` exposing `7233` (gRPC) and `8233` (Web UI).
  3. `api`: Built from `Dockerfile`, runs `node dist/server.js` on port `3000`, `SUPPLIER_BASE_URL=http://localhost:3000`.
  4. `worker`: Built from the same `Dockerfile`, overrides command to `node dist/temporal/worker.js`, `SUPPLIER_BASE_URL=http://api:3000`, `TEMPORAL_ADDRESS=temporal:7233`, `REDIS_URL=redis://redis:6379`.
