# Vida Rider API

NestJS backend for the Vida Rider delivery partner app.

## Quick Start

```bash
cp .env.example .env
npm install
docker compose up -d
npm run migration:run
npm run seed
npm run start:dev
```

HTTP API: `http://localhost:3000/api`

Socket.IO: `ws://localhost:3000/ws`

PostgreSQL is exposed on host port `5433` to avoid colliding with a local Postgres on `5432`.

All HTTP responses use `{ "success": true, "request_id": "...", "data": ... }` or `{ "success": false, "request_id": "...", "error": ... }`.

Each response also includes an `X-Request-Id` header. Request and response payloads are logged as JSON Lines to `./logs/api-requests.jsonl` by default.
