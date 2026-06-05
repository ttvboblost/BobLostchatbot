# WhatsApp Bot (Baileys)

A WhatsApp bot that connects via QR Code, forwards messages to an external webhook (Lovable Project 1), and exposes a status/QR API for an external dashboard (Lovable Project 3).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server + WhatsApp bot (port 5000 in dev, assigned by workflow)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- WhatsApp: @whiskeysockets/baileys 6.7.0 (installed via direct npm registry, bypasses package firewall)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/whatsapp/bot.ts` — Baileys connection, QR handling, message forwarding, webhook calls, auto-reconnect
- `artifacts/api-server/src/whatsapp/state.ts` — Shared mutable state (qr string, connection status, processed message IDs)
- `artifacts/api-server/src/routes/whatsapp.ts` — `GET /api/qr` and `GET /api/status` endpoints
- `artifacts/api-server/.whatsapp-session/` — Baileys auth session files (persisted across restarts)

## API Endpoints

- `GET /api/qr` → `{ qr: string | null, status: "waiting" | "connected" }`
- `GET /api/status` → `{ status: "connected" | "disconnected" }`
- `GET /api/healthz` → `{ status: "ok" }`

## Webhook

Messages are forwarded to:
```
POST https://boblost-assistente-core.lovable.app/api/public/webhook
{ user_id, message, type: "whatsapp", timestamp }
```
Response `{ reply: "text" }` is sent back to the WhatsApp sender.

## Architecture decisions

- Baileys is externalized in esbuild (not bundled) because it uses dynamic requires and CJS patterns incompatible with bundling
- `makeWASocket` import uses a `.default ??` fallback to handle CJS/ESM interop when externalized
- WhatsApp session is stored at `.whatsapp-session/` (relative to CWD) for persistence across Replit restarts
- Webhook calls have an 8s timeout and 1 automatic retry on failure
- Processed message IDs are tracked in a Set (capped at 1000) to prevent duplicate handling

## Product

- WhatsApp bot receives messages, forwards to external AI webhook, replies back
- External dashboard can poll `/api/qr` to display the QR for scanning and `/api/status` to monitor connection

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `@whiskeysockets/baileys` is blocked by Replit's package firewall — must be installed with `--registry https://registry.npmjs.org/`
- `protobufjs` (transitive dep) also blocked by firewall — same `--registry` flag resolves it
- `protobufjs` must be in `onlyBuiltDependencies` in `pnpm-workspace.yaml` to run its build scripts
- Do NOT run `pnpm install` without `--registry https://registry.npmjs.org/` if Baileys is missing — it will fail

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
