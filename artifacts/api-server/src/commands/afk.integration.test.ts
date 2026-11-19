import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { formatAfkDuration } from "./service.js";

const canRunDatabaseTest = Boolean(process.env["DATABASE_URL"]);
let closeDatabase: (() => Promise<void>) | undefined;

test("formats AFK duration using readable Portuguese units", () => {
  assert.equal(formatAfkDuration(0), "menos de 1 segundo");
  assert.equal(formatAfkDuration(25_000), "25 segundos");
  assert.equal(formatAfkDuration(5 * 60_000 + 12_000), "5 minutos e 12 segundos");
  assert.equal(formatAfkDuration(2 * 60 * 60_000 + 35 * 60_000), "2 horas e 35 minutos");
});

test(
  "persists AFK by group, handles mentions and returns on the user's own message",
  { skip: !canRunDatabaseTest },
  async () => {
    const [
      { afkStatusesTable, authorizedGroupsTable, commandLogsTable, db, pool, processedMessageEventsTable },
      { and, eq, inArray },
      { processIncomingCommand },
    ] = await Promise.all([
      import("@workspace/db"),
      import("drizzle-orm"),
      import("./service.js"),
    ]);
    closeDatabase = () => pool.end();

    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const groupA = `${suffix}@g.us`;
    const groupB = `${suffix}b@g.us`;
    const userA = `${suffix}1@s.whatsapp.net`;
    const userB = `${suffix}2@lid`;
    const userC = `${suffix}3@s.whatsapp.net`;
    const otherUser = `${suffix}4@s.whatsapp.net`;
    const sent: Array<{ jid: string; text: string; mentions?: string[] }> = [];
    let primaryError: unknown;
    const socket = {
      sendMessage: async (
        jid: string,
        content: { text: string; mentions?: string[] },
      ) => {
        sent.push({ jid, ...content });
        return { key: { id: `sent-${sent.length}` } };
      },
      groupMetadata: async () => ({ subject: "AFK integration group" }),
      logout: async () => {},
      end: () => {},
    };

    const input = (values: {
      groupId: string;
      senderJid: string;
      text: string | null;
      messageId: string;
      mentionedJids?: string[];
      hasUserContent?: boolean;
    }) => ({
      socket,
      senderName: "Test participant",
      ...values,
    });

    try {
      await db.insert(authorizedGroupsTable).values([
        { groupId: groupA, groupName: "AFK group A", isAuthorized: true },
        { groupId: groupB, groupName: "AFK group B", isAuthorized: true },
      ]);

      const activation = input({
        groupId: groupA,
        senderJid: userA,
        text: "!afk vou jogar\nhttps://example.test 🎮",
        messageId: `afk-${suffix}`,
      });
      await Promise.all([
        processIncomingCommand(activation),
        processIncomingCommand(activation),
      ]);
      assert.equal(sent.length, 1, "duplicate activation events must reply once");
      assert.equal(sent[0]?.jid, groupA);
      assert.deepEqual(sent[0]?.mentions, [userA]);
      assert.match(sent[0]?.text ?? "", /😴 @[\w]+ está AFK!/);
      assert.ok(sent[0]?.text.includes("https://example.test 🎮"));

      const [storedA] = await db
        .select()
        .from(afkStatusesTable)
        .where(eq(afkStatusesTable.userJid, userA));
      assert.equal(storedA?.groupId, groupA);
      assert.equal(storedA?.reason, "vou jogar\nhttps://example.test 🎮");
      assert.ok(storedA?.activatedAt instanceof Date);

      await processIncomingCommand(
        input({
          groupId: groupA,
          senderJid: userB,
          text: "!afk",
          messageId: `afk-default-${suffix}`,
        }),
      );
      const [storedB] = await db
        .select()
        .from(afkStatusesTable)
        .where(eq(afkStatusesTable.userJid, userB));
      assert.equal(storedB?.reason, "Não informou um motivo.");
      assert.equal(sent.at(-1)?.jid, groupA, "a participant LID must never be the reply destination");
      assert.deepEqual(sent.at(-1)?.mentions, [userB]);
      assert.ok(sent.at(-1)?.text.includes("Não informou um motivo."));

      await processIncomingCommand(
        input({
          groupId: groupB,
          senderJid: userC,
          text: "!afk grupo B",
          messageId: `afk-group-b-${suffix}`,
        }),
      );
      const beforeMentionCount = sent.length;
      await processIncomingCommand(
        input({
          groupId: groupA,
          senderJid: otherUser,
          text: "@afk",
          messageId: `mention-many-${suffix}`,
          mentionedJids: [userA, userA, userB, userC],
          hasUserContent: true,
        }),
      );
      assert.equal(sent.length, beforeMentionCount + 1);
      const multiMentionReply = sent.at(-1);
      assert.equal(multiMentionReply?.jid, groupA);
      assert.deepEqual(new Set(multiMentionReply?.mentions), new Set([userA, userB]));
      assert.ok(multiMentionReply?.text.includes("vou jogar"));
      assert.ok(multiMentionReply?.text.includes("Não informou um motivo."));
      assert.ok(!multiMentionReply?.text.includes("grupo B"));

      const afkAfterMention = await db
        .select({ userJid: afkStatusesTable.userJid })
        .from(afkStatusesTable)
        .where(inArray(afkStatusesTable.userJid, [userA, userB]));
      assert.equal(afkAfterMention.length, 2, "mentions must not clear AFK");

      await processIncomingCommand(
        input({
          groupId: groupB,
          senderJid: userA,
          text: "message in a different group",
          messageId: `wrong-group-${suffix}`,
          hasUserContent: true,
        }),
      );
      const groupBAfk = await db
        .select({ groupId: afkStatusesTable.groupId })
        .from(afkStatusesTable)
        .where(eq(afkStatusesTable.userJid, userA));
      assert.equal(groupBAfk[0]?.groupId, groupA);

      await db
        .update(afkStatusesTable)
        .set({ activatedAt: new Date(Date.now() - (2 * 60 + 35) * 60_000) })
        .where(
          and(
            eq(afkStatusesTable.groupId, groupA),
            eq(afkStatusesTable.userJid, userA),
          ),
        );
      await processIncomingCommand(
        input({
          groupId: groupA,
          senderJid: userA,
          text: "voltei",
          messageId: `return-text-${suffix}`,
          hasUserContent: true,
        }),
      );
      const welcomeBack = sent.at(-1);
      assert.equal(welcomeBack?.jid, groupA);
      assert.deepEqual(welcomeBack?.mentions, [userA]);
      assert.ok(welcomeBack?.text.includes("2 horas e 35 minutos"));
      assert.equal(
        (
          await db
            .select()
            .from(afkStatusesTable)
            .where(
              and(
                eq(afkStatusesTable.groupId, groupA),
                eq(afkStatusesTable.userJid, userA),
              ),
            )
        ).length,
        0,
      );

      await processIncomingCommand(
        input({
          groupId: groupA,
          senderJid: userB,
          text: "figurinha",
          messageId: `return-sticker-${suffix}`,
          hasUserContent: true,
        }),
      );
      assert.ok(sent.at(-1)?.text.includes("Seu status AFK foi removido."));
      assert.equal(
        (
          await db
            .select()
            .from(afkStatusesTable)
            .where(
              and(
                eq(afkStatusesTable.groupId, groupA),
                eq(afkStatusesTable.userJid, userB),
              ),
            )
        ).length,
        0,
        "the user's own non-text message must clear AFK",
      );

      const persistedGroupB = await db
        .select()
        .from(afkStatusesTable)
        .where(
          and(
            eq(afkStatusesTable.groupId, groupB),
            eq(afkStatusesTable.userJid, userC),
          ),
        );
      assert.equal(persistedGroupB.length, 1, "AFK persists independently per group");
      assert.equal(persistedGroupB[0]?.reason, "grupo B");
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try {
        await db
          .delete(processedMessageEventsTable)
          .where(inArray(processedMessageEventsTable.groupId, [groupA, groupB]));
        await db
          .delete(afkStatusesTable)
          .where(inArray(afkStatusesTable.groupId, [groupA, groupB]));
        await db
          .delete(commandLogsTable)
          .where(inArray(commandLogsTable.groupId, [groupA, groupB]));
        await db
          .delete(authorizedGroupsTable)
          .where(inArray(authorizedGroupsTable.groupId, [groupA, groupB]));
      } catch (cleanupError) {
        if (!primaryError) throw cleanupError;
      }
    }
  },
);

after(async () => {
  await closeDatabase?.();
});
