import { createServer } from "node:http";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { attachWebSocketServer } from "./websocket/hub.js";
import { startWhatsAppBot, stopWhatsAppForShutdown } from "./whatsapp/bot.js";
import { upsertBotSettings } from "./commands/service.js";
import { pool } from "@workspace/db";

if (!process.env["DATABASE_URL"]) {
  throw new Error("DATABASE_URL is required to use the managed PostgreSQL database.");
}
if (!process.env["ADMIN_TOKEN"] || process.env["ADMIN_TOKEN"].length < 32) {
  throw new Error("ADMIN_TOKEN must be configured with at least 32 characters.");
}
if (!process.env["SESSION_SECRET"] || process.env["SESSION_SECRET"].length < 32) {
  throw new Error("SESSION_SECRET must be configured with at least 32 characters.");
}

const rawPort = process.env["PORT"];
if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}
const port = Number(rawPort);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);
attachWebSocketServer(server);

await pool.query("SELECT 1");
await upsertBotSettings();

server.listen(port, () => {
  logger.info({ port }, "Servidor BobLost iniciado");
  void startWhatsAppBot().catch((error: unknown) => {
    logger.error({ err: error }, "Falha ao iniciar o bot WhatsApp");
  });
});

let isShuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, "Encerrando servidor");
  stopWhatsAppForShutdown();
  server.close(() => {
    void pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
