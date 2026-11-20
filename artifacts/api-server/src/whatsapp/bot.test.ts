import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createResilientSocketAdapter,
  extractMentionedJids,
  hasNormalUserContent,
} from "./bot.js";

test("reads and deduplicates participant JIDs from Baileys mention context", () => {
  assert.deepEqual(
    extractMentionedJids({
      extendedTextMessage: {
        text: "Are you there?",
        contextInfo: {
          mentionedJid: [
            "5511999990001@s.whatsapp.net",
            "5511999990001@s.whatsapp.net",
            "5511999990002@lid",
          ],
        },
      },
    }),
    ["5511999990001@s.whatsapp.net", "5511999990002@lid"],
  );
});

test("counts stickers as user activity but ignores protocol and system events", () => {
  assert.equal(hasNormalUserContent({ stickerMessage: { mimetype: "image/webp" } }), true);
  assert.equal(hasNormalUserContent({ imageMessage: { caption: "hello" } }), true);
  assert.equal(hasNormalUserContent({ protocolMessage: {} }), false);
  assert.equal(
    hasNormalUserContent({ extendedTextMessage: { text: "system event" } }, 7),
    false,
  );
});

test("retries a transient Baileys send after reconnect with the same message ID", async () => {
  const destinations: string[] = [];
  const messageIds: string[] = [];
  const firstSocket = {
    sendMessage: async (
      jid: string,
      _content: { text: string; mentions?: string[] },
      options?: { messageId?: string },
    ): Promise<{ key: { id: string | undefined } }> => {
      destinations.push(jid);
      messageIds.push(options?.messageId ?? "");
      throw Object.assign(new Error("Connection Closed"), {
        output: { statusCode: 428 },
      });
    },
    groupMetadata: async () => ({ subject: "test" }),
    logout: async () => {},
    end: () => {},
  };
  const secondSocket = {
    ...firstSocket,
    sendMessage: async (
      jid: string,
      _content: { text: string; mentions?: string[] },
      options?: { messageId?: string },
    ) => {
      destinations.push(jid);
      messageIds.push(options?.messageId ?? "");
      return { key: { id: options?.messageId } };
    },
  };
  let activeSnapshot = { socket: firstSocket, generation: 1 };
  const adapter = createResilientSocketAdapter(
    () => activeSnapshot,
    async (generation) => {
      assert.equal(generation, 1);
      activeSnapshot = { socket: secondSocket, generation: 2 };
      return activeSnapshot;
    },
  );

  const result = await adapter.sendMessage(
    "120000000-123@g.us",
    { text: "reply", mentions: ["5511999990001@s.whatsapp.net"] },
    { messageId: "BAE5A1B2C3D4E5F6" },
  );

  assert.deepEqual(destinations, ["120000000-123@g.us", "120000000-123@g.us"]);
  assert.deepEqual(messageIds, ["BAE5A1B2C3D4E5F6", "BAE5A1B2C3D4E5F6"]);
  assert.deepEqual(result, { key: { id: "BAE5A1B2C3D4E5F6" } });
  assert.deepEqual(adapter.getSendDiagnostics?.(), {
    connected: true,
    generation: 2,
  });
});
