import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  afkStatusesTable,
  authorizedGroupsTable,
  botSettingsTable,
  commandLogsTable,
  commandsTable,
  db,
  processedMessageEventsTable,
} from "@workspace/db";
import type { ActiveSocket } from "../whatsapp/state.js";
import { publishEvent } from "../websocket/hub.js";
import {
  isMessageEligibleForReply,
  parseCommand,
  renderCommandResponse,
} from "./processor.js";
import { logger } from "../lib/logger.js";

interface IncomingGroupMessage {
  socket: ActiveSocket;
  groupId: string;
  senderJid: string | null;
  senderName: string | null;
  text: string | null;
  messageId?: string;
  mentionedJids?: string[];
  hasUserContent?: boolean;
}

const DEFAULT_AFK_REASON = "Não informou um motivo.";
const MESSAGE_ID_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MESSAGE_ID_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastMessageIdPruneAt = 0;

async function writeCommandLog(
  groupId: string,
  senderJid: string | null,
  commandName: string,
  status: string,
  commandId: string | null,
): Promise<void> {
  await db.insert(commandLogsTable).values({
    groupId,
    senderJid,
    commandName,
    status,
    commandId,
  });
}

function getSafeErrorDetails(error: unknown): {
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

function participantMention(jid: string): string {
  const userId = jid.split("@", 1)[0]?.split(":", 1)[0];
  return `@${userId || "participante"}`;
}

export function formatAfkDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  if (totalSeconds === 0) return "menos de 1 segundo";
  if (totalSeconds < 60) {
    return `${totalSeconds} ${totalSeconds === 1 ? "segundo" : "segundos"}`;
  }
  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const minuteText = `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
    if (seconds === 0) return minuteText;
    return `${minuteText} e ${seconds} ${seconds === 1 ? "segundo" : "segundos"}`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const hourText = `${hours} ${hours === 1 ? "hora" : "horas"}`;
  if (minutes === 0) return hourText;
  return `${hourText} e ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
}

async function claimMessageEvent(
  groupId: string,
  messageId: string,
): Promise<boolean> {
  const [claimed] = await db
    .insert(processedMessageEventsTable)
    .values({ groupId, messageId })
    .onConflictDoNothing()
    .returning({ messageId: processedMessageEventsTable.messageId });

  if (!claimed) return false;

  const now = Date.now();
  if (now - lastMessageIdPruneAt >= MESSAGE_ID_PRUNE_INTERVAL_MS) {
    lastMessageIdPruneAt = now;
    void db
      .delete(processedMessageEventsTable)
      .where(
        lt(
          processedMessageEventsTable.processedAt,
          new Date(now - MESSAGE_ID_RETENTION_MS),
        ),
      )
      .catch((error: unknown) => {
        logger.warn(
          getSafeErrorDetails(error),
          "Falha ao limpar identificadores antigos de mensagens",
        );
      });
  }
  return true;
}

async function sendGroupReply(
  message: IncomingGroupMessage,
  text: string,
  options: { mentions?: string[]; action: string },
): Promise<boolean> {
  try {
    const messageId = `BAE5${randomBytes(6).toString("hex").toUpperCase()}`;
    await message.socket.sendMessage(message.groupId, {
      text,
      ...(options.mentions?.length ? { mentions: options.mentions } : {}),
    }, { messageId });
    logger.info(
      {
        action: options.action,
        groupId: message.groupId,
        destinationJid: message.groupId,
        messageId: message.messageId ?? null,
      },
      "Resposta enviada ao grupo de origem",
    );
    return true;
  } catch (error) {
    const details = getSafeErrorDetails(error);
    logger.error(
      {
        ...details,
        action: options.action,
        groupId: message.groupId,
        destinationJid: message.groupId,
        messageId: message.messageId ?? null,
      },
      "Baileys sendMessage falhou no grupo de origem",
    );
    publishEvent("connection.error", {
      message: "Não foi possível enviar uma resposta ao grupo de origem.",
      action: options.action,
      statusCode: details.statusCode ?? null,
    });
    return false;
  }
}

export async function processIncomingCommand(
  message: IncomingGroupMessage,
): Promise<void> {
  const parsed = message.text ? parseCommand(message.text) : null;
  if (parsed) {
    logger.info(
      {
        groupId: message.groupId,
        messageId: message.messageId ?? null,
        commandName: parsed.name,
        senderPresent: Boolean(message.senderJid),
      },
      "Comando recebido no grupo",
    );
    publishEvent("command.received", {
      groupId: message.groupId,
      commandName: parsed.name,
    });
  }

  const [group] = await db
    .select()
    .from(authorizedGroupsTable)
    .where(eq(authorizedGroupsTable.groupId, message.groupId))
    .limit(1);

  const eligible = isMessageEligibleForReply({
    remoteJid: message.groupId,
    fromMe: false,
    groupAuthorized: group?.isAuthorized === true,
  });
  if (!eligible) {
    if (parsed) {
      await writeCommandLog(
        message.groupId,
        message.senderJid,
        parsed.name,
        "blocked_group",
        null,
      );
      logger.info(
        { groupId: message.groupId, commandName: parsed.name },
        "Comando ignorado: grupo não autorizado",
      );
    }
    return;
  }

  const mentionedJids = [
    ...new Set(
      (message.mentionedJids ?? []).filter(
        (jid) => typeof jid === "string" && jid.length > 0 && jid !== message.senderJid,
      ),
    ),
  ];
  const hasUserContent =
    message.hasUserContent ?? Boolean(message.text?.trim());
  const [ownAfk] =
    message.senderJid && hasUserContent
      ? await db
          .select()
          .from(afkStatusesTable)
          .where(
            and(
              eq(afkStatusesTable.groupId, message.groupId),
              eq(afkStatusesTable.userJid, message.senderJid),
            ),
          )
          .limit(1)
      : [];
  const afkMentions =
    mentionedJids.length > 0
      ? await db
          .select()
          .from(afkStatusesTable)
          .where(
            and(
              eq(afkStatusesTable.groupId, message.groupId),
              inArray(afkStatusesTable.userJid, mentionedJids),
            ),
          )
      : [];
  const isAfkActivation = parsed?.name === "afk";
  const hasAfkAction = Boolean(isAfkActivation || ownAfk || afkMentions.length);
  if (
    message.messageId &&
    (parsed || hasAfkAction) &&
    !(await claimMessageEvent(message.groupId, message.messageId))
  ) {
    logger.debug(
      { groupId: message.groupId, messageId: message.messageId },
      "Evento Baileys duplicado ignorado",
    );
    return;
  }

  if (isAfkActivation) {
    if (!message.senderJid) {
      await writeCommandLog(
        message.groupId,
        null,
        "afk",
        "missing_sender",
        null,
      );
      logger.warn(
        { groupId: message.groupId, messageId: message.messageId ?? null },
        "Comando AFK ignorado: identificador do participante ausente",
      );
      return;
    }
    const reason = parsed.argumentsText || DEFAULT_AFK_REASON;
    const [afkStatus] = await db
      .insert(afkStatusesTable)
      .values({
        groupId: message.groupId,
        userJid: message.senderJid,
        reason,
        activatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [afkStatusesTable.groupId, afkStatusesTable.userJid],
        set: { reason, activatedAt: new Date() },
      })
      .returning();
    const mention = participantMention(message.senderJid);
    const sent = await sendGroupReply(
      message,
      `😴 ${mention} está AFK!\n\n📝 Motivo: ${afkStatus?.reason ?? reason}`,
      { mentions: [message.senderJid], action: "afk_activated" },
    );
    await writeCommandLog(
      message.groupId,
      message.senderJid,
      "afk",
      sent ? "afk_activated" : "afk_activation_send_failed",
      null,
    );
    publishEvent("afk.activated", {
      groupId: message.groupId,
      userJid: message.senderJid,
      sent,
    });
    return;
  }

  if (ownAfk && message.senderJid && hasUserContent) {
    const returnedAt = new Date();
    const [removedAfk] = await db
      .delete(afkStatusesTable)
      .where(
        and(
          eq(afkStatusesTable.groupId, message.groupId),
          eq(afkStatusesTable.userJid, message.senderJid),
        ),
      )
      .returning();
    if (removedAfk) {
      const duration = formatAfkDuration(
        returnedAt.getTime() - removedAfk.activatedAt.getTime(),
      );
      const sent = await sendGroupReply(
        message,
        `👋 Bem-vindo de volta, ${participantMention(message.senderJid)}!\n\n✅ Seu status AFK foi removido.\n\n⏱️ Você ficou AFK por: ${duration}.`,
        { mentions: [message.senderJid], action: "afk_returned" },
      );
      if (!sent) {
        await db
          .insert(afkStatusesTable)
          .values({
            groupId: removedAfk.groupId,
            userJid: removedAfk.userJid,
            reason: removedAfk.reason,
            activatedAt: removedAfk.activatedAt,
          })
          .onConflictDoNothing();
      }
      await writeCommandLog(
        message.groupId,
        message.senderJid,
        "afk",
        sent ? "afk_returned" : "afk_return_send_failed",
        null,
      );
      publishEvent("afk.returned", {
        groupId: message.groupId,
        userJid: message.senderJid,
        sent,
      });
    }
  }

  if (afkMentions.length > 0) {
    const uniqueAfkRows = [
      ...new Map(afkMentions.map((status) => [status.userJid, status])).values(),
    ];
    const text = uniqueAfkRows
      .map(
        (status) =>
          `😴 ${participantMention(status.userJid)} está AFK!\n\n📝 Motivo: ${status.reason.trim() || DEFAULT_AFK_REASON}`,
      )
      .join("\n\n");
    const sent = await sendGroupReply(message, text, {
      mentions: uniqueAfkRows.map((status) => status.userJid),
      action: "afk_mention",
    });
    await writeCommandLog(
      message.groupId,
      message.senderJid,
      "afk_mention",
      sent ? "afk_mention_notified" : "afk_mention_send_failed",
      null,
    );
    publishEvent("afk.mentioned", {
      groupId: message.groupId,
      userJids: uniqueAfkRows.map((status) => status.userJid),
      sent,
    });
  }

  if (!parsed) return;

  const [command] = await db
    .select()
    .from(commandsTable)
    .where(eq(commandsTable.name, parsed.name))
    .limit(1);

  const isNativeCommandList = ["comandos", "menu"].includes(parsed.name);
  if (command && !command.isActive && !isNativeCommandList) {
    await writeCommandLog(
      message.groupId,
      message.senderJid,
      parsed.name,
      "inactive_command",
      command.id,
    );
    logger.info(
      { groupId: message.groupId, commandName: parsed.name },
      "Comando ignorado: comando desativado",
    );
    return;
  }

  let responseContent = command?.responseContent;
  if (isNativeCommandList) {
    const activeCommands = await db
      .select({ name: commandsTable.name })
      .from(commandsTable)
      .where(
        and(
          eq(commandsTable.isActive, true),
          ne(commandsTable.name, "afk"),
        ),
      )
      .orderBy(commandsTable.name);
    const commandNames = new Set(activeCommands.map(({ name }) => name));
    commandNames.add("afk");
    const dynamicList = `Comandos disponíveis: ${[...commandNames]
      .sort((left, right) => left.localeCompare(right))
      .map((name) => `!${name}`)
      .join(", ")}`;
    const customIntro = command?.isActive ? command.responseContent.trim() : "";
    responseContent = customIntro
      ? `${customIntro}\n\n${dynamicList}`
      : dynamicList;
  }

  if (!responseContent) {
    await writeCommandLog(
      message.groupId,
      message.senderJid,
      parsed.name,
      "unknown_command",
      null,
    );
    logger.info(
      { groupId: message.groupId, commandName: parsed.name },
      "Comando desconhecido: nenhuma resposta cadastrada",
    );
    return;
  }

  const [settings] = await db
    .select({ timezone: botSettingsTable.timezone })
    .from(botSettingsTable)
    .where(eq(botSettingsTable.id, "primary"))
    .limit(1);
  const timezone = settings?.timezone ?? "America/Sao_Paulo";
  const groupName = group?.groupName?.trim() || message.groupId;
  const response = renderCommandResponse(responseContent, {
    name: message.senderName?.trim() || "pessoa",
    group: groupName,
    now: new Date(),
    timezone,
  });

  const sent = await sendGroupReply(message, response, {
    action: `command_${parsed.name}`,
  });
  if (!sent) {
    await writeCommandLog(
      message.groupId,
      message.senderJid,
      parsed.name,
      "send_failed",
      command?.id ?? null,
    );
    publishEvent("command.executed", {
      groupId: message.groupId,
      commandName: parsed.name,
      status: "send_failed",
    });
    return;
  }

  await writeCommandLog(
    message.groupId,
    message.senderJid,
    parsed.name,
    "executed",
    command?.id ?? null,
  );
  publishEvent("command.executed", {
    groupId: message.groupId,
    commandName: parsed.name,
    status: "executed",
  });
}

export async function upsertBotSettings(): Promise<void> {
  await db
    .insert(botSettingsTable)
    .values({ id: "primary" })
    .onConflictDoNothing();
}

export async function getCommandCount(): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(commandsTable)
    .where(and(eq(commandsTable.isActive, true)));
  return result?.count ?? 0;
}
