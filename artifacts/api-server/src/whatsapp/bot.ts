import makeWASocketImport, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcodeTerminal from "qrcode-terminal";
import path from "node:path";
import { rm } from "node:fs/promises";
import { logger } from "../lib/logger.js";
import { whatsappState } from "./state.js";

// Handle CJS/ESM interop: externalized CJS module may wrap the function under .default
const makeWASocket: typeof makeWASocketImport =
  (makeWASocketImport as any).default ?? makeWASocketImport;

const WEBHOOK_URL =
  "https://boblost-assistente-core.lovable.app/api/public/webhook";
const WEBHOOK_TIMEOUT_MS = 8000;
const AUTH_DIR = path.resolve(process.cwd(), ".whatsapp-session");

// ─── Fix 2: Cache Baileys version after first successful fetch ────────────────
// fetchLatestBaileysVersion() makes an HTTP request. If it fails during reconnect
// (network blip), the catch block fires and schedules a 10s retry that also starts
// with the same failing network call — an infinite loop that never generates a QR.
// Caching the version after the first success breaks this dependency.
let cachedVersion: [number, number, number] | null = null;

async function getBaileysVersion(): Promise<[number, number, number]> {
  if (cachedVersion) return cachedVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    cachedVersion = version;
    logger.info({ version }, "Versão do Baileys obtida do servidor");
    return cachedVersion;
  } catch (err) {
    // Fallback to a known-good version so reconnect can proceed without network
    const fallback: [number, number, number] = [2, 3000, 1023853467];
    logger.warn({ err, fallback }, "Falha ao buscar versão do Baileys — usando fallback embutido");
    cachedVersion = fallback;
    return fallback;
  }
}

// ─── Fix 3: Guard against concurrent startWhatsAppBot() calls ────────────────
// Without this, both the connection.update handler and the catch block can schedule
// a reconnect in the same error window, creating two sockets that race to read and
// write the same auth state files (useMultiFileAuthState has no file locking).
let isStarting = false;

// ─── Fix 1: Fatal disconnect codes that invalidate auth state ────────────────
// These codes mean the credentials on disk are permanently invalid. Re-using them
// causes an immediate re-rejection with the same code, looping forever without
// ever reaching the QR generation step. The auth directory must be cleared so the
// next connection starts with fresh keys and triggers a new QR.
const FATAL_DISCONNECT_CODES = new Set([
  DisconnectReason.loggedOut,  // 401 — user removed this device from their phone
  DisconnectReason.badSession, // 500 — corrupted session state
  DisconnectReason.forbidden,  // 403 — account banned or session blocked
]);

async function clearAuthState(): Promise<void> {
  try {
    await rm(AUTH_DIR, { recursive: true, force: true });
    logger.info({ authDir: AUTH_DIR }, "Estado de autenticação limpo — próxima conexão gerará novo QR");
  } catch (err) {
    logger.warn({ err }, "Erro ao limpar estado de autenticação");
  }
}

// ─────────────────────────────────────────────────────────────────────────────

// Exported so the admin route can reuse the exact same webhook call flow
// without duplicating any logic.
export async function callWebhook(
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
  // ── Fix 3: prevent concurrent starts ──────────────────────────────────────
  if (isStarting) {
    logger.warn("startWhatsAppBot já em execução — chamada duplicada ignorada");
    return;
  }
  isStarting = true;

  logger.info("Iniciando bot WhatsApp...");

  try {
    // ── Fix 2: use cached version, never block on network during reconnect ──
    const version = await getBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    logger.info({ version, authDir: AUTH_DIR }, "Sessão carregada, criando socket...");

    const sock: WASocket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ["WhatsApp Bot", "Chrome", "1.0.0"],
      connectTimeoutMs: 30_000,
      keepAliveIntervalMs: 10_000,
    });

    sock.ev.on("creds.update", saveCreds);

    // Expose the active socket through shared state so the admin route can
    // send messages without coupling to the Baileys WASocket type directly.
    whatsappState.sock = sock;

    sock.ev.on("connection.update", async (update) => {
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
        whatsappState.sock = null;

        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;

        logger.warn({ statusCode }, "Conexão com WhatsApp encerrada");

        // ── Fix 1: clear stale auth state for fatal codes ──────────────────
        // For codes that permanently invalidate the session, delete the auth
        // directory so the next connection starts clean and generates a QR.
        // Without this, the bot loops forever re-trying with invalid creds.
        if (statusCode !== undefined && FATAL_DISCONNECT_CODES.has(statusCode)) {
          logger.info(
            { statusCode },
            "Código fatal detectado — limpando autenticação para gerar novo QR",
          );
          await clearAuthState();
        }

        // Release the guard BEFORE scheduling the reconnect so the timer
        // callback can acquire it normally when it runs.
        isStarting = false;
        logger.info("Reconectando em 3 segundos...");
        setTimeout(() => startWhatsAppBot(), 3000);
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
    // Release guard so the retry can run
    isStarting = false;
    setTimeout(() => startWhatsAppBot(), 10_000);
  }
}
