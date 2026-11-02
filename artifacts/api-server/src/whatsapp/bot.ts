import makeWASocketImport, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from "@whiskeysockets/baileys";
import { normalizeMessageContent } from "@whiskeysockets/baileys/lib/Utils/messages.js";
import { eq } from "drizzle-orm";
import { authorizedGroupsTable, db } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { processIncomingCommand } from "../commands/service.js";
import { observeGroup } from "../groups/service.js";
import { publishEvent } from "../websocket/hub.js";
import {
  deletePersistentAuthState,
  loadPersistentAuthState,
  updateWhatsAppSessionStatus,
} from "./persistent-auth.js";
import { whatsappState, type ActiveSocket } from "./state.js";

const makeWASocket: typeof makeWASocketImport =
  (makeWASocketImport as any).default ?? makeWASocketImport;

const FATAL_DISCONNECT_CODES = new Set<number>([
  DisconnectReason.loggedOut,
  DisconnectReason.badSession,
  DisconnectReason.forbidden,
]);
const RECONNECT_DELAYS_MS = [3000, 5000, 10000, 20000, 40000, 60000];

let cachedVersion: [number, number, number] | null = null;
let isStarting = false;
let shouldReconnect = true;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const observedGroupIds = new Set<string>();

async function getBaileysVersion(): Promise<[number, number, number]> {
  if (cachedVersion) return cachedVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    cachedVersion = version;
    logger.info({ version }, "Versão do Baileys obtida do servidor");
  } catch (error) {
    cachedVersion = [2, 3000, 1023853467];
    logger.warn(
      { err: error },
      "Não foi possível consultar a versão do WhatsApp; usando a versão compatível conhecida",
    );
  }
  return cachedVersion;
}

function scheduleReconnect(): void {
  if (!shouldReconnect || reconnectTimer) return;
  const delay =
    RECONNECT_DELAYS_MS[
      Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
    ] ?? 60000;
  reconnectAttempt += 1;
  whatsappState.status = "connecting";
  publishEvent("whatsapp.reconnecting", {
    attempt: reconnectAttempt,
    delayMs: delay,
  });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void openWhatsAppConnection();
  }, delay);
}

async function rememberObservedGroup(
  socket: ActiveSocket,
  groupId: string,
): Promise<void> {
  if (observedGroupIds.has(groupId)) return;
  const [knownGroup] = await db
    .select({ groupName: authorizedGroupsTable.groupName })
    .from(authorizedGroupsTable)
    .where(eq(authorizedGroupsTable.groupId, groupId))
    .limit(1);

  if (knownGroup?.groupName) {
    observedGroupIds.add(groupId);
    return;
  }

  let groupName: string | null = null;
  try {
    groupName = (await socket.groupMetadata(groupId)).subject?.trim() || null;
  } catch (error) {
    logger.debug({ err: error, groupId }, "Metadados do grupo indisponíveis");
  }
  await observeGroup(groupId, groupName);
  observedGroupIds.add(groupId);
}

async function processMessages(
  socket: ActiveSocket,
  messages: Array<{
    key: {
      id?: string | null;
      remoteJid?: string | null;
      participant?: string | null;
      fromMe?: boolean | null;
    };
    message?: {
      conversation?: string | null;
      extendedTextMessage?: { text?: string | null } | null;
      imageMessage?: { caption?: string | null } | null;
      videoMessage?: { caption?: string | null } | null;
    } | null;
    pushName?: string | null;
  }>,
): Promise<void> {
  for (const message of messages) {
    if (!message.message || message.key.fromMe) continue;
    const groupId = message.key.remoteJid;
    if (!groupId?.endsWith("@g.us")) continue;

    const messageId = message.key.id;
    if (!messageId || whatsappState.processedIds.has(messageId)) continue;
    whatsappState.processedIds.add(messageId);
    if (whatsappState.processedIds.size > 1000) {
      const oldestIds = Array.from(whatsappState.processedIds).slice(0, 200);
      for (const id of oldestIds) whatsappState.processedIds.delete(id);
    }

    const content = normalizeMessageContent(message.message as never);
    const text =
      content?.conversation ??
      content?.extendedTextMessage?.text ??
      content?.imageMessage?.caption ??
      content?.videoMessage?.caption ??
      null;
    await rememberObservedGroup(socket, groupId);
    if (!text?.trim()) continue;

    await processIncomingCommand({
      socket,
      groupId,
      senderJid: message.key.participant ?? null,
      senderName: message.pushName ?? null,
      text,
    });
  }
}

async function openWhatsAppConnection(): Promise<void> {
  if (isStarting || whatsappState.status === "connected") return;
  isStarting = true;
  whatsappState.status = "connecting";
  publishEvent("whatsapp.reconnecting", { attempt: reconnectAttempt });

  try {
    const version = await getBaileysVersion();
    const { state, saveCreds } = await loadPersistentAuthState();
    if (!shouldReconnect) {
      isStarting = false;
      return;
    }
    const socket: WASocket = makeWASocket({
      version,
      auth: state,
      logger: logger.child({ component: "baileys" }, { level: "error" }) as never,
      printQRInTerminal: false,
      browser: ["BobLost WhatsApp Bot", "Chrome", "1.0.0"],
      connectTimeoutMs: 30_000,
      keepAliveIntervalMs: 10_000,
    });
    const activeSocket = socket as unknown as ActiveSocket;
    whatsappState.sock = activeSocket;

    socket.ev.on("creds.update", () => {
      void saveCreds().catch((error: unknown) => {
        logger.error({ err: error }, "Falha ao persistir credenciais do WhatsApp");
        publishEvent("connection.error", { message: "Falha ao salvar a sessão." });
      });
    });

    socket.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        whatsappState.qr = qr;
        whatsappState.qrTimestamp = Date.now();
        whatsappState.status = "waiting_qr";
        publishEvent("qr.updated", {
          timestamp: new Date(whatsappState.qrTimestamp).toISOString(),
        });
        logger.info("QR do WhatsApp atualizado");
      }

      if (connection === "open") {
        isStarting = false;
        reconnectAttempt = 0;
        whatsappState.status = "connected";
        whatsappState.qr = null;
        whatsappState.qrTimestamp = null;
        void updateWhatsAppSessionStatus(true).catch((error: unknown) => {
          logger.error({ err: error }, "Falha ao atualizar status persistido");
        });
        publishEvent("whatsapp.connected");
        logger.info("WhatsApp conectado");
      }

      if (connection === "close") {
        isStarting = false;
        whatsappState.status = "disconnected";
        whatsappState.qr = null;
        whatsappState.qrTimestamp = null;
        whatsappState.sock = null;
        void updateWhatsAppSessionStatus(false).catch((error: unknown) => {
          logger.error({ err: error }, "Falha ao atualizar status persistido");
        });

        const error = lastDisconnect?.error as
          | (Error & { output?: { statusCode?: number } })
          | undefined;
        const statusCode = error?.output?.statusCode;
        publishEvent("whatsapp.disconnected", { statusCode: statusCode ?? null });
        if (statusCode !== undefined && FATAL_DISCONNECT_CODES.has(statusCode)) {
          void deletePersistentAuthState().catch((deleteError: unknown) => {
            logger.error(
              { err: deleteError },
              "Falha ao apagar sessão inválida do WhatsApp",
            );
          });
        }
        if (error) {
          publishEvent("connection.error", {
            statusCode: statusCode ?? null,
            message: "A conexão com o WhatsApp foi encerrada.",
          });
          logger.warn({ statusCode }, "Conexão com o WhatsApp encerrada");
        }
        scheduleReconnect();
      }
    });

    socket.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      void processMessages(activeSocket, messages).catch((error: unknown) => {
        logger.error({ err: error }, "Erro ao processar mensagens recebidas");
        publishEvent("connection.error", {
          message: "Falha ao processar uma mensagem recebida.",
        });
      });
    });
  } catch (error) {
    isStarting = false;
    whatsappState.sock = null;
    whatsappState.status = "disconnected";
    logger.error({ err: error }, "Falha ao iniciar conexão com WhatsApp");
    publishEvent("connection.error", {
      message: "Não foi possível iniciar a conexão com o WhatsApp.",
    });
    scheduleReconnect();
  }
}

export async function startWhatsAppBot(): Promise<void> {
  shouldReconnect = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  await openWhatsAppConnection();
}

export async function disconnectWhatsApp(): Promise<void> {
  shouldReconnect = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const socket = whatsappState.sock;
  const wasConnected = whatsappState.status === "connected";
  whatsappState.sock = null;
  whatsappState.qr = null;
  whatsappState.qrTimestamp = null;
  whatsappState.status = "disconnected";
  isStarting = false;

  let persistenceError: unknown;
  try {
    await deletePersistentAuthState();
  } catch (error) {
    persistenceError = error;
    logger.error({ err: error }, "Falha ao remover a sessão persistida do WhatsApp");
  }
  try {
    if (socket && wasConnected) {
      await socket.logout();
    } else {
      socket?.end(new Error("Conexão encerrada pelo administrador."));
    }
  } catch (error) {
    logger.warn({ err: error }, "Falha ao encerrar socket do WhatsApp");
  }

  publishEvent("whatsapp.disconnected", { manual: true });
  logger.info("WhatsApp desconectado pelo administrador");
  if (persistenceError) throw persistenceError;
}

export function stopWhatsAppForShutdown(): void {
  shouldReconnect = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const socket = whatsappState.sock;
  whatsappState.sock = null;
  socket?.end(new Error("Servidor sendo encerrado."));
}
