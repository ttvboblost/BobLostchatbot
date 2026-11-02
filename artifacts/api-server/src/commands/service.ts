import { and, eq, sql } from "drizzle-orm";
import {
  authorizedGroupsTable,
  botSettingsTable,
  commandLogsTable,
  commandsTable,
  db,
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
  text: string;
}

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

export async function processIncomingCommand(
  message: IncomingGroupMessage,
): Promise<void> {
  const parsed = parseCommand(message.text);
  if (!parsed) return;

  publishEvent("command.received", {
    groupId: message.groupId,
    commandName: parsed.name,
  });

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
    await writeCommandLog(
      message.groupId,
      message.senderJid,
      parsed.name,
      "blocked_group",
      null,
    );
    return;
  }

  const [command] = await db
    .select()
    .from(commandsTable)
    .where(eq(commandsTable.name, parsed.name))
    .limit(1);

  if (command && !command.isActive) {
    await writeCommandLog(
      message.groupId,
      message.senderJid,
      parsed.name,
      "inactive_command",
      command.id,
    );
    return;
  }

  let responseContent = command?.responseContent;
  if (!command && parsed.name === "comandos") {
    const activeCommands = await db
      .select({ name: commandsTable.name })
      .from(commandsTable)
      .where(eq(commandsTable.isActive, true))
      .orderBy(commandsTable.name);
    responseContent = activeCommands.length
      ? `Comandos disponíveis: ${activeCommands.map(({ name }) => `!${name}`).join(", ")}`
      : "Ainda não há comandos ativos.";
  }

  if (!responseContent) {
    await writeCommandLog(
      message.groupId,
      message.senderJid,
      parsed.name,
      "unknown_command",
      null,
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

  try {
    // Always reply to the exact JID that originated this command.
    await message.socket.sendMessage(message.groupId, { text: response });
  } catch (error) {
    logger.error(
      { err: error, groupId: message.groupId, commandName: parsed.name },
      "Falha ao enviar resposta do comando no grupo de origem",
    );
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
