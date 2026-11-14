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
const QR_TTL_MS = 55_000;
const SEND_RETRY_LIMIT = 2;
const RECONNECT_WAIT_TIMEOUT_MS = 90_000;

let cachedVersion: [number, number, number] | null = null;
let isStarting = false;
let shouldReconnect = true;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let qrExpiryTimer: ReturnType<typeof setTimeout> | null = null;
let connectionGeneration = 0;
let connectedSocketGeneration = 0;
const observedGroupIds = new Set<string>();
type ConnectedSocketSnapshot = {
  socket: ActiveSocket;
  generation: number;
};
type ConnectedSocketWaiter = {
  afterGeneration: number;
  resolve: (snapshot: ConnectedSocketSnapshot) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
const connectedSocketWaiters = new Set<ConnectedSocketWaiter>();

function clearQrExpiryTimer(): void {
  if (!qrExpiryTimer) return;
  clearTimeout(qrExpiryTimer);
  qrExpiryTimer = null;
}

function safeErrorDetails(error: unknown): {
  errorName: string;
  errorCode?: string | number;
  statusCode?: number;
} {
  if (typeof error !== "object" || error === null) {
    return { errorName: "UnknownError" };
  }
  const details: {
    errorName: string;
    errorCode?: string | number;
    statusCode?: number;
  } = {
    errorName:
      "name" in error && typeof error.name === "string"
        ? error.name
        : "UnknownError",
  };
  if (
    "code" in error &&
    (typeof error.code === "string" || typeof error.code === "number")
  ) {
    details.errorCode = error.code;
  }
  if (
    "output" in error &&
    typeof error.output === "object" &&
    error.output !== null &&
    "statusCode" in error.output &&
    typeof error.output.statusCode === "number"
  ) {
    details.statusCode = error.output.statusCode;
  }
  return details;
}

function getConnectedSocketSnapshot(): ConnectedSocketSnapshot | null {
  if (whatsappState.status !== "connected" || !whatsappState.sock) return null;
  return {
    socket: whatsappState.sock,
    generation: connectedSocketGeneration,
  };
}

function waitForConnectedSocketAfter(
  afterGeneration: number,
  timeoutMs: number,
): Promise<ConnectedSocketSnapshot> {
  const current = getConnectedSocketSnapshot();
  if (current && current.generation > afterGeneration) {
    return Promise.resolve(current);
  }

  return new Promise((resolve, reject) => {
    const waiter: ConnectedSocketWaiter = {
      afterGeneration,
      resolve,
      reject,
      timer: setTimeout(() => {
        connectedSocketWaiters.delete(waiter);
        reject(new Error("Timed out waiting for WhatsApp reconnection."));
      }, timeoutMs),
    };
    connectedSocketWaiters.add(waiter);
  });
}

function notifyConnectedSocket(snapshot: ConnectedSocketSnapshot): void {
  for (const waiter of connectedSocketWaiters) {
    if (snapshot.generation <= waiter.afterGeneration) continue;
    clearTimeout(waiter.timer);
    connectedSocketWaiters.delete(waiter);
    waiter.resolve(snapshot);
  }
}

function isTransientSendError(error: unknown): boolean {
  const details = safeErrorDetails(error);
  if ([408, 428, 503].includes(details.statusCode ?? -1)) return true;
  return ["ECONNRESET", "ETIMEDOUT", "EPIPE", "ERR_STREAM_DESTROYED"].includes(
    String(details.errorCode ?? ""),
  );
}

export function createResilientSocketAdapter(
  getConnectedSocket: () => ConnectedSocketSnapshot | null,
  waitForConnectedSocket: (
    afterGeneration: number,
    timeoutMs: number,
  ) => Promise<ConnectedSocketSnapshot>,
): ActiveSocket {
  return {
    async sendMessage(jid, content, options) {
      let snapshot =
        getConnectedSocket() ??
        (await waitForConnectedSocket(-1, RECONNECT_WAIT_TIMEOUT_MS));
      let retries = 0;

      while (true) {
        try {
          return await snapshot.socket.sendMessage(jid, content, options);
        } catch (error) {
          if (!isTransientSendError(error) || retries >= SEND_RETRY_LIMIT) {
            throw error;
          }
          retries += 1;
          snapshot = await waitForConnectedSocket(
            snapshot.generation,
            RECONNECT_WAIT_TIMEOUT_MS,
          );
        }
      }
    },
    async groupMetadata(jid) {
      const snapshot = getConnectedSocket();
      if (!snapshot) throw new Error("WhatsApp is not connected.");
      return snapshot.socket.groupMetadata(jid);
    },
    async logout() {
      const snapshot = getConnectedSocket();
      if (!snapshot) throw new Error("WhatsApp is not connected.");
      await snapshot.socket.logout();
    },
    end(error) {
      getConnectedSocket()?.socket.end(error);
    },
  };
}

const resilientSocket = createResilientSocketAdapter(
  getConnectedSocketSnapshot,
  waitForConnectedSocketAfter,
);

async function getBaileysVersion(): Promise<[number, number, number]> {
  if (cachedVersion) return cachedVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    cachedVersion = version;
    logger.info({ version }, "Versão do Baileys obtida do servidor");
  } catch (error) {
    cachedVersion = [2, 3000, 1023853467];
    logger.warn(
      safeErrorDetails(error),
      "Não foi possível consultar a versão do WhatsApp; usando a versão compatível conhecida",
    );
  }
  return cachedVersion;
}

function scheduleReconnect(status: "connecting" | "error" = "connecting"): void {
  if (!shouldReconnect || reconnectTimer) return;
  const delay =
    RECONNECT_DELAYS_MS[
      Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
    ] ?? 60000;
  reconnectAttempt += 1;
  whatsappState.status = status;
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
    logger.debug(
      { ...safeErrorDetails(error), groupId },
      "Metadados do grupo indisponíveis",
    );
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
      participantAlt?: string | null;
      fromMe?: boolean | null;
    };
    message?: {
      conversation?: string | null;
      extendedTextMessage?: { text?: string | null } | null;
      imageMessage?: { caption?: string | null } | null;
      videoMessage?: { caption?: string | null } | null;
    } | null;
    pushName?: string | null;
    messageStubType?: number | null;
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
      content?.documentMessage?.caption ??
      null;
    try {
      await rememberObservedGroup(socket, groupId);
    } catch (error) {
      logger.error(
        {
          ...safeErrorDetails(error),
          groupId,
          messageId,
        },
        "Falha ao registrar o grupo da mensagem recebida",
      );
    }
    const mentionedJids = extractMentionedJids(content);
    const hasUserContent = hasNormalUserContent(
      content,
      message.messageStubType,
    );
    if (!text?.trim() && mentionedJids.length === 0 && !hasUserContent) {
      continue;
    }

    try {
      await processIncomingCommand({
        socket: resilientSocket,
        groupId,
        senderJid:
          message.key.participant ?? message.key.participantAlt ?? null,
        senderName: message.pushName ?? null,
        text: text?.trim() ? text : null,
        messageId,
        mentionedJids,
        hasUserContent,
      });
    } catch (error) {
      logger.error(
        {
          ...safeErrorDetails(error),
          groupId,
          messageId,
          senderPresent: Boolean(
            message.key.participant ?? message.key.participantAlt,
          ),
        },
        "Falha no processamento da mensagem recebida",
      );
      publishEvent("connection.error", {
        message: "Falha ao processar uma mensagem recebida.",
      });
    }
  }
}

export function extractMentionedJids(content: unknown): string[] {
  if (typeof content !== "object" || content === null) return [];
  const message = content as Record<string, unknown>;
  const candidates = [
    message.extendedTextMessage,
    message.imageMessage,
    message.videoMessage,
    message.documentMessage,
    message.buttonsResponseMessage,
    message.listResponseMessage,
    message.templateButtonReplyMessage,
    message.messageContextInfo,
  ];
  const mentionedJids = new Set<string>();
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const contextInfo =
      "contextInfo" in candidate
        ? (candidate as { contextInfo?: unknown }).contextInfo
        : candidate;
    if (typeof contextInfo !== "object" || contextInfo === null) continue;
    const values = (contextInfo as { mentionedJid?: unknown }).mentionedJid;
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (typeof value === "string" && value.length > 0) {
        mentionedJids.add(value);
      }
    }
  }
  return [...mentionedJids];
}

export function hasNormalUserContent(
  content: unknown,
  messageStubType?: number | null,
): boolean {
  if (messageStubType) return false;
  if (typeof content !== "object" || content === null) return false;
  const systemFields = new Set([
    "messageContextInfo",
    "protocolMessage",
    "senderKeyDistributionMessage",
  ]);
  return Object.keys(content).some((field) => !systemFields.has(field));
}

async function openWhatsAppConnection(): Promise<void> {
  if (
    isStarting ||
    whatsappState.sock ||
    whatsappState.status === "connected"
  ) {
    return;
  }
  isStarting = true;
  whatsappState.status = "connecting";
  whatsappState.lastError = null;
  const generation = ++connectionGeneration;
  publishEvent("whatsapp.reconnecting", { attempt: reconnectAttempt });

  try {
    const version = await getBaileysVersion();
    const { state, saveCreds } = await loadPersistentAuthState();
    if (!shouldReconnect || generation !== connectionGeneration) {
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
    if (!shouldReconnect || generation !== connectionGeneration) {
      socket.end(new Error("Conexão substituída por uma ação administrativa."));
      isStarting = false;
      return;
    }
    whatsappState.sock = activeSocket;

    socket.ev.on("creds.update", () => {
      void saveCreds().catch((error: unknown) => {
        logger.error(
          safeErrorDetails(error),
          "Falha ao persistir credenciais do WhatsApp",
        );
        publishEvent("connection.error", { message: "Falha ao salvar a sessão." });
      });
    });

    socket.ev.on("connection.update", (update) => {
      if (
        generation !== connectionGeneration ||
        whatsappState.sock !== activeSocket
      ) {
        return;
      }
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        clearQrExpiryTimer();
        whatsappState.qr = qr;
        whatsappState.qrTimestamp = Date.now();
        whatsappState.qrExpiresAt = whatsappState.qrTimestamp + QR_TTL_MS;
        whatsappState.qrExpired = false;
        whatsappState.status = "waiting_qr";
        whatsappState.lastError = null;
        publishEvent("qr.updated", {
          timestamp: new Date(whatsappState.qrTimestamp).toISOString(),
          expiresAt: new Date(whatsappState.qrExpiresAt).toISOString(),
        });
        logger.info("QR do WhatsApp atualizado");
        const issuedAt = whatsappState.qrTimestamp;
        qrExpiryTimer = setTimeout(() => {
          if (
            generation !== connectionGeneration ||
            whatsappState.sock !== activeSocket ||
            whatsappState.qrTimestamp !== issuedAt ||
            whatsappState.status !== "waiting_qr"
          ) {
            return;
          }
          qrExpiryTimer = null;
          whatsappState.qr = null;
          whatsappState.qrExpiresAt = null;
          whatsappState.qrExpired = true;
          whatsappState.status = "connecting";
          isStarting = false;
          whatsappState.sock = null;
          publishEvent("qr.expired", {});
          logger.info("QR do WhatsApp expirou; solicitando um novo código");
          activeSocket.end(new Error("QR de vinculação expirado."));
          scheduleReconnect();
        }, QR_TTL_MS);
      }

      if (connection === "open") {
        clearQrExpiryTimer();
        isStarting = false;
        reconnectAttempt = 0;
        whatsappState.status = "connected";
        connectedSocketGeneration = generation;
        whatsappState.qr = null;
        whatsappState.qrTimestamp = null;
        whatsappState.qrExpiresAt = null;
        whatsappState.qrExpired = false;
        whatsappState.lastError = null;
        void updateWhatsAppSessionStatus(true).catch((error: unknown) => {
          logger.error(
            safeErrorDetails(error),
            "Falha ao atualizar status persistido",
          );
        });
        publishEvent("whatsapp.connected");
        logger.info("WhatsApp conectado");
        notifyConnectedSocket({
          socket: activeSocket,
          generation,
        });
      }

      if (connection === "close") {
        clearQrExpiryTimer();
        isStarting = false;
        whatsappState.status = "disconnected";
        whatsappState.qr = null;
        whatsappState.qrTimestamp = null;
        whatsappState.qrExpiresAt = null;
        whatsappState.sock = null;
        void updateWhatsAppSessionStatus(false).catch((error: unknown) => {
          logger.error(
            safeErrorDetails(error),
            "Falha ao atualizar status persistido",
          );
        });

        const error = lastDisconnect?.error as
          | (Error & { output?: { statusCode?: number } })
          | undefined;
        const statusCode = error?.output?.statusCode;
        publishEvent("whatsapp.disconnected", { statusCode: statusCode ?? null });
        if (statusCode !== undefined && FATAL_DISCONNECT_CODES.has(statusCode)) {
          shouldReconnect = false;
          whatsappState.status = "error";
          whatsappState.lastError =
            "A sessão do WhatsApp precisa ser desvinculada manualmente antes de um novo pareamento.";
          publishEvent("connection.error", {
            statusCode,
            message: whatsappState.lastError,
          });
          logger.warn(
            { statusCode },
            "Sessão do WhatsApp exige ação administrativa explícita",
          );
          return;
        }
        if (error) {
          whatsappState.lastError = "A conexão com o WhatsApp foi interrompida.";
          publishEvent("connection.error", {
            statusCode: statusCode ?? null,
            message: whatsappState.lastError,
          });
          logger.warn({ statusCode }, "Conexão com o WhatsApp encerrada");
        } else {
          whatsappState.lastError = null;
        }
        scheduleReconnect();
      }
    });

    socket.ev.on("messages.upsert", ({ messages, type }) => {
      if (
        generation !== connectionGeneration ||
        whatsappState.sock !== activeSocket
      ) {
        return;
      }
      if (type !== "notify") return;
      void processMessages(activeSocket, messages).catch((error: unknown) => {
        logger.error(
          safeErrorDetails(error),
          "Erro ao processar mensagens recebidas",
        );
        publishEvent("connection.error", {
          message: "Falha ao processar uma mensagem recebida.",
        });
      });
    });
  } catch (error) {
    if (generation !== connectionGeneration) return;
    isStarting = false;
    whatsappState.sock = null;
    whatsappState.status = "error";
    whatsappState.lastError = "Não foi possível iniciar a conexão com o WhatsApp.";
    const errorName =
      typeof error === "object" && error !== null && "name" in error
        ? String(error.name)
        : "UnknownError";
    logger.error({ errorName }, "Falha ao iniciar conexão com WhatsApp");
    publishEvent("connection.error", {
      message: whatsappState.lastError,
    });
    scheduleReconnect("error");
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

  connectionGeneration += 1;
  clearQrExpiryTimer();
  const socket = whatsappState.sock;
  whatsappState.sock = null;
  whatsappState.qr = null;
  whatsappState.qrTimestamp = null;
  whatsappState.qrExpiresAt = null;
  whatsappState.qrExpired = false;
  whatsappState.lastError = null;
  whatsappState.status = "disconnected";
  isStarting = false;

  try {
    await updateWhatsAppSessionStatus(false);
  } catch (error) {
    logger.error(
      safeErrorDetails(error),
      "Falha ao atualizar status persistido do WhatsApp",
    );
  }
  try {
    socket?.end(new Error("Conexão encerrada pelo administrador."));
  } catch (error) {
    logger.warn({ errorName: error instanceof Error ? error.name : "UnknownError" }, "Falha ao encerrar socket do WhatsApp");
  }

  publishEvent("whatsapp.disconnected", { manual: true });
  logger.info("WhatsApp desconectado pelo administrador; sessão preservada");
}

export async function restartWhatsApp(): Promise<void> {
  shouldReconnect = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  connectionGeneration += 1;
  clearQrExpiryTimer();
  const socket = whatsappState.sock;
  whatsappState.sock = null;
  whatsappState.qr = null;
  whatsappState.qrTimestamp = null;
  whatsappState.qrExpiresAt = null;
  whatsappState.qrExpired = false;
  whatsappState.lastError = null;
  whatsappState.status = "connecting";
  isStarting = false;
  try {
    await updateWhatsAppSessionStatus(false);
  } catch (error) {
    logger.error(
      safeErrorDetails(error),
      "Falha ao atualizar status antes da reinicialização",
    );
  }
  socket?.end(new Error("Conexão reiniciada pelo administrador."));
  publishEvent("whatsapp.restarting", { manual: true });
  shouldReconnect = true;
  await openWhatsAppConnection();
}

export async function unlinkWhatsApp(): Promise<void> {
  shouldReconnect = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  connectionGeneration += 1;
  clearQrExpiryTimer();
  const socket = whatsappState.sock;
  const wasConnected = whatsappState.status === "connected";
  whatsappState.sock = null;
  whatsappState.qr = null;
  whatsappState.qrTimestamp = null;
  whatsappState.qrExpiresAt = null;
  whatsappState.qrExpired = false;
  whatsappState.lastError = null;
  whatsappState.status = "disconnected";
  isStarting = false;

  try {
    if (socket && wasConnected) {
      await socket.logout();
    } else {
      socket?.end(new Error("Sessão removida pelo administrador."));
    }
  } catch (error) {
    logger.warn(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Falha ao encerrar socket durante desvinculação explícita",
    );
  }
  await deletePersistentAuthState();
  publishEvent("whatsapp.disconnected", { manual: true, sessionDeleted: true });
  logger.info("Sessão do WhatsApp removida por ação administrativa explícita");
}

export function stopWhatsAppForShutdown(): void {
  shouldReconnect = false;
  connectionGeneration += 1;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  clearQrExpiryTimer();
  const socket = whatsappState.sock;
  whatsappState.sock = null;
  whatsappState.qr = null;
  whatsappState.qrTimestamp = null;
  whatsappState.qrExpiresAt = null;
  whatsappState.qrExpired = false;
  isStarting = false;
  socket?.end(new Error("Servidor sendo encerrado."));
  void updateWhatsAppSessionStatus(false).catch((error: unknown) => {
    logger.warn(
      safeErrorDetails(error),
      "Falha ao atualizar o status no encerramento",
    );
  });
}
