# Hotel Offer Orchestrator

A Node.js 20 and TypeScript service that coordinates mock hotel suppliers with Temporal. Supplier responses are deduplicated by normalized hotel name, the lowest-priced offer is kept (with commission as the equal-price tie-breaker), and offers are stored in Redis sorted sets. Price ranges are applied by Redis, not by filtering the results in application memory.

## Architecture

- **API**: Express serves `GET /api/hotels`, supplier endpoints, a supplier downtime toggle, and `GET /health`.
- **Temporal worker**: Fetches both suppliers concurrently, tolerates one supplier being unavailable, deduplicates results, and stores the offers in Redis.
- **Redis**: Stores per-city offers in sorted sets and performs score-range queries.
- **Temporal server and UI**: Temporal runs against Postgres; the UI is available separately on port 8233.
- **Docker image**: A multi-stage Node 20 Alpine build compiles TypeScript, then installs production dependencies in the runtime image. The same image runs the API or worker.

## Requirements and startup

For the containerized setup, install Docker Desktop with Docker Compose support. From the project root:

```sh
docker compose up --build
```

Compose starts Redis, Postgres (the Temporal persistence database), Temporal, the Temporal UI, the API, and the worker. The API listens on `http://localhost:3000`; the Temporal UI is at `http://localhost:8233`.

To stop the services:

```sh
docker compose down
```

For local development with Node.js 20 or newer:

```sh
npm ci
npm run build
npm test
```

Run Redis and Temporal separately, then set the environment variables below in the shell. Start the API with `npm run dev` and the worker in a second terminal with `npm run worker`.

## Environment variables

The configuration loader validates these variables at startup. Compose sets container-appropriate values automatically.

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime environment: `development`, `production`, or `test`. |
| `PORT` | `3000` | HTTP port for the API. |
| `LOG_LEVEL` | `info` | Pino log level. |
| `SUPPLIER_BASE_URL` | `http://localhost:3000` | Base URL used by worker activities for both supplier endpoints. |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL. |
| `REDIS_CACHE_TTL_SECONDS` | `300` | TTL for non-empty city offer sets. |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal gRPC address. |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace. |
| `TEMPORAL_TASK_QUEUE` | `hotel-offer-orchestration` | Queue used by the API and worker. |
| `SUPPLIER_A_DOWN` | `false` | Initial Supplier A downtime flag. |
| `SUPPLIER_B_DOWN` | `false` | Initial Supplier B downtime flag. |

Activities construct supplier URLs as `${SUPPLIER_BASE_URL}/supplierA/hotels` and `${SUPPLIER_BASE_URL}/supplierB/hotels`. In Compose, the API uses `http://localhost:3000` and the worker uses `http://api:3000`. The application uses `SUPPLIER_BASE_URL`; it does not read separate `SUPPLIER_A_URL` or `SUPPLIER_B_URL` variables.

## API and curl verification

After startup, these five requests verify the health check, both supplier routes, the main search route, and Redis price filtering:

```sh
curl -i http://localhost:3000/health
curl -i "http://localhost:3000/supplierA/hotels?city=delhi"
curl -i "http://localhost:3000/supplierB/hotels?city=delhi"
curl -i "http://localhost:3000/api/hotels?city=delhi"
curl -i "http://localhost:3000/api/hotels?city=delhi&minPrice=5500&maxPrice=6500"
```

The health endpoint returns `200` with `{"status":"ok","redis":"connected"}` when Redis responds, and `503` with `{"status":"degraded","redis":"disconnected"}` when it does not. Search requests require a non-empty `city`; optional price bounds must be finite, non-negative numbers, and `minPrice` cannot exceed `maxPrice`. Invalid query parameters return `400`. If both suppliers fail, the API returns `502`; if only one fails, results from the healthy supplier are retained.

The runtime toggle allows testing supplier fallback without restarting:

```sh
curl -i -X POST http://localhost:3000/mock/suppliers/A/status \
  -H "Content-Type: application/json" \
  -d '{"down":true}'
curl -i "http://localhost:3000/api/hotels?city=delhi"
curl -i -X POST http://localhost:3000/mock/suppliers/A/status \
  -H "Content-Type: application/json" \
  -d '{"down":false}'
```

## Tests

```sh
npm test
```

The unit tests cover deterministic deduplication and Redis sorted-set persistence and price-range query behavior.
