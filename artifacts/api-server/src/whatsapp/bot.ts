import makeWASocketImport, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcodeTerminal from "qrcode-terminal";
import path from "node:path";
import { logger } from "../lib/logger.js";
import { whatsappState } from "./state.js";

// Handle CJS/ESM interop: externalized CJS module may wrap the function under .default
const makeWASocket: typeof makeWASocketImport =
  (makeWASocketImport as any).default ?? makeWASocketImport;

const WEBHOOK_URL =
  "https://boblost-assistente-core.lovable.app/api/public/webhook";
const WEBHOOK_TIMEOUT_MS = 8000;
const AUTH_DIR = path.resolve(process.cwd(), ".whatsapp-session");

async function callWebhook(
  userId: string,
  message: string,
): Promise<string | null> {
  const payload = {
    user_id: userId,
    message,
    type: "whatsapp",
    timestamp: new Date().toISOString(),
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        WEBHOOK_TIMEOUT_MS,
      );

      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Webhook retornou status ${response.status}`);
      }

      const data = (await response.json()) as { reply?: string };
      logger.info({ attempt }, "Webhook respondeu com sucesso");
      return data.reply ?? null;
    } catch (err) {
      logger.warn({ err, attempt }, `Tentativa ${attempt} do webhook falhou`);
      if (attempt === 2) {
        logger.error({ err }, "Webhook falhou após 2 tentativas");
        return null;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return null;
}

export async function startWhatsAppBot(): Promise<void> {
  logger.info("Iniciando bot WhatsApp...");

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    logger.info({ version, authDir: AUTH_DIR }, "Versão do Baileys carregada");

    const sock: WASocket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ["WhatsApp Bot", "Chrome", "1.0.0"],
      connectTimeoutMs: 30_000,
      keepAliveIntervalMs: 10_000,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        whatsappState.qr = qr;
        whatsappState.status = "aguardando_qr";
        logger.info(
          "══════════════════════════════════════\n" +
            "  QR Code gerado — escaneie com o WhatsApp  \n" +
            "══════════════════════════════════════",
        );
        qrcodeTerminal.generate(qr, { small: true });
      }

      if (connection === "close") {
        whatsappState.status = "desconectado";
        whatsappState.qr = null;

        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn(
          { statusCode, shouldReconnect },
          "Conexão com WhatsApp encerrada",
        );

        const delay = shouldReconnect ? 3000 : 5000;
        logger.info(
          { delay },
          shouldReconnect
            ? "Reconectando automaticamente..."
            : "Sessão encerrada (logout) — reconectando para novo QR...",
        );
        setTimeout(() => startWhatsAppBot(), delay);
      }

      if (connection === "open") {
        whatsappState.status = "conectado";
        whatsappState.qr = null;
        logger.info("✅ WhatsApp conectado com sucesso!");
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        if (!msg.message) continue;
        if (msg.key.fromMe) continue;

        const msgId = msg.key.id;
        if (!msgId) continue;

        if (whatsappState.processedIds.has(msgId)) {
          logger.debug({ msgId }, "Mensagem duplicada ignorada");
          continue;
        }
        whatsappState.processedIds.add(msgId);

        if (whatsappState.processedIds.size > 1000) {
          const toDelete = Array.from(whatsappState.processedIds).slice(0, 200);
          toDelete.forEach((id) => whatsappState.processedIds.delete(id));
        }

        const sender = msg.key.remoteJid;
        if (!sender) continue;

        const text =
          msg.message.conversation ??
          msg.message.extendedTextMessage?.text ??
          null;

        if (!text || text.trim() === "") {
          logger.debug({ sender }, "Mensagem sem texto ignorada");
          continue;
        }

        logger.info({ sender, text }, "Mensagem recebida");

        try {
          const reply = await callWebhook(sender, text);

          if (reply) {
            await sock.sendMessage(sender, { text: reply });
            logger.info({ sender }, "Resposta enviada ao usuário");
          } else {
            logger.warn(
              { sender },
              "Webhook sem resposta — nenhuma mensagem enviada",
            );
          }
        } catch (err) {
          logger.error({ err, sender }, "Erro ao processar mensagem");
        }
      }
    });
  } catch (err) {
    logger.error(
      { err },
      "Erro crítico ao iniciar bot WhatsApp — tentando novamente em 10s",
    );
    setTimeout(() => startWhatsAppBot(), 10_000);
  }
}
