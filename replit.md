# BobLost WhatsApp Bot

Backend and responsive admin panel for one WhatsApp account, dynamic group
commands, protected administration endpoints, and real-time events. Replies are
limited to the originating authorized group; private chats and bot-authored
messages are ignored.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — start API and WhatsApp bot
- `pnpm run typecheck` — check all workspace packages
- `pnpm --filter @workspace/api-server run test` — unit and database integration tests
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API clients and Zod schemas
- `pnpm --filter @workspace/db run push` — apply schema to configured PostgreSQL

## Required Secrets

- `DATABASE_URL` — Replit-managed PostgreSQL connection
- `ADMIN_TOKEN` — administrative bearer token (minimum 32 characters)
- `SESSION_SECRET` — stable encryption secret (minimum 32 characters)

Optional: `ADMIN_CORS_ORIGINS`, a comma-separated allowlist for trusted web
origins.

## Stack

- Node.js 24, TypeScript, Express 5
- Baileys 6.7 for one WhatsApp Web account
- Replit-managed PostgreSQL with Drizzle ORM
- Zod request validation, Pino structured logs, `ws` WebSocket server

## API

- `GET /api/healthz` — server and database health
- `GET /api/status` — safe connection status
- `GET /api/qr` — protected QR status and SVG
- `/api/admin/*` — protected WhatsApp, command, group, and log endpoints
- `/api/admin/session/*` — signed HttpOnly admin browser session
- `GET /api/ws` — real-time events; authenticate with a first message containing
  `{ "type": "auth", "token": "<ADMIN_TOKEN>" }`

See `artifacts/api-server/README.md` and `lib/api-spec/openapi.yaml` for endpoint,
database, and setup details.

## Security and Session Handling

- Admin HTTP endpoints use constant-time bearer-token comparison or a signed,
  HttpOnly, SameSite cookie session, with per-client request limits.
- QR data and session credentials are never logged.
- WhatsApp credentials and keys are encrypted with AES-256-GCM before storage.
- RLS is enabled on application tables with no public policies.
- Do not send messages to a different group or to direct conversations.

## Project Layout

- `artifacts/api-server/src/whatsapp` — Baileys connection and encrypted auth state
- `artifacts/api-server/src/commands` — command parsing, execution, and tests
- `artifacts/api-server/src/groups` — group discovery and authorization
- `artifacts/api-server/src/routes` — REST API
- `artifacts/api-server/src/websocket` — authenticated event stream
- `lib/db/src/schema` — PostgreSQL tables and indexes
- `lib/api-spec/openapi.yaml` — documented API contract
