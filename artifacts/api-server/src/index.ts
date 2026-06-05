import app from "./app.js";
import { logger } from "./lib/logger.js";
import { startWhatsAppBot } from "./whatsapp/bot.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Erro ao iniciar servidor");
    process.exit(1);
  }

  logger.info({ port }, "Servidor iniciado com sucesso");

  startWhatsAppBot().catch((err) => {
    logger.error({ err }, "Erro fatal ao iniciar bot WhatsApp");
  });
});
