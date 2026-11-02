import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

const canRunDatabaseTest = Boolean(process.env["SUPABASE_DB_URL"]);
let closeDatabase: (() => Promise<void>) | undefined;

test(
  "persists command state and sends replies only to its authorized source group",
  { skip: !canRunDatabaseTest },
  async () => {
    const {
      authorizedGroupsTable,
      commandLogsTable,
      commandsTable,
      db,
      pool,
    } = await import("@workspace/db");
    const { eq, inArray } = await import("drizzle-orm");
    const { processIncomingCommand } = await import("./service.js");
    closeDatabase = () => pool.end();

    const groupId = `${randomUUID().replaceAll("-", "")}-test@g.us`;
    const blockedGroupId = `${randomUUID().replaceAll("-", "")}-blocked@g.us`;
    const name = `test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const replies: Array<{ jid: string; text: string }> = [];
    let primaryError: unknown;
    const socket = {
      sendMessage: async (jid: string, content: { text: string }) => {
        replies.push({ jid, text: content.text });
      },
      groupMetadata: async () => ({ subject: "Test group" }),
      logout: async () => {},
      end: () => {},
    };

    try {
      await db.insert(authorizedGroupsTable).values({
        groupId,
        groupName: "Test group",
        isAuthorized: true,
      });
      await db.insert(commandsTable).values({
        name,
        description: "temporary integration test",
        responseContent: "Olá {nome} em {grupo}",
        isActive: false,
      });

      await processIncomingCommand({
        socket,
        groupId,
        senderJid: "5511999999999@s.whatsapp.net",
        senderName: "Ana",
        text: `!${name}`,
      });
      assert.equal(replies.length, 0, "inactive commands must not reply");

      await db
        .update(commandsTable)
        .set({ isActive: true })
        .where(eq(commandsTable.name, name));
      await processIncomingCommand({
        socket,
        groupId,
        senderJid: "5511999999999@s.whatsapp.net",
        senderName: "Ana",
        text: `!${name}`,
      });
      assert.equal(replies.length, 1);
      assert.equal(replies[0]?.jid, groupId);
      assert.match(replies[0]?.text ?? "", /Olá Ana em Test group/);

      await processIncomingCommand({
        socket,
        groupId: blockedGroupId,
        senderJid: "5511888888888@s.whatsapp.net",
        senderName: "Bruno",
        text: `!${name}`,
      });
      assert.equal(replies.length, 1, "unapproved groups must not receive replies");

      const logs = await db
        .select({ status: commandLogsTable.status })
        .from(commandLogsTable)
        .where(inArray(commandLogsTable.groupId, [groupId, blockedGroupId]));
      assert.ok(logs.some((log) => log.status === "inactive_command"));
      assert.ok(logs.some((log) => log.status === "executed"));
      assert.ok(logs.some((log) => log.status === "blocked_group"));
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try {
        await db
          .delete(commandLogsTable)
          .where(inArray(commandLogsTable.groupId, [groupId, blockedGroupId]));
        await db.delete(commandsTable).where(eq(commandsTable.name, name));
        await db
          .delete(authorizedGroupsTable)
          .where(inArray(authorizedGroupsTable.groupId, [groupId, blockedGroupId]));
      } catch (cleanupError) {
        if (!primaryError) throw cleanupError;
      }
    }
  },
);

after(async () => {
  await closeDatabase?.();
});
