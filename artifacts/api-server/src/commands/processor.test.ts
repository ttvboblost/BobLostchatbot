import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isMessageEligibleForReply,
  parseCommand,
  renderCommandResponse,
} from "./processor.js";

test("parses valid commands and separates optional arguments", () => {
  assert.deepEqual(parseCommand("!Live now"), {
    name: "live",
    argumentsText: "now",
  });
  assert.deepEqual(parseCommand("  !youtube  "), {
    name: "youtube",
    argumentsText: "",
  });
});

test("rejects malformed command names and ordinary messages", () => {
  assert.equal(parseCommand("!"), null);
  assert.equal(parseCommand("!!live"), null);
  assert.equal(parseCommand("hello !live"), null);
  assert.deepEqual(parseCommand("!command name"), {
    name: "command",
    argumentsText: "name",
  });
});

test("only permits replies in the authorized source group", () => {
  assert.equal(
    isMessageEligibleForReply({
      remoteJid: "120000000000000000@g.us",
      fromMe: false,
      groupAuthorized: true,
    }),
    true,
  );
  assert.equal(
    isMessageEligibleForReply({
      remoteJid: "5511999999999@s.whatsapp.net",
      fromMe: false,
      groupAuthorized: true,
    }),
    false,
  );
  assert.equal(
    isMessageEligibleForReply({
      remoteJid: "120000000000000000@g.us",
      fromMe: true,
      groupAuthorized: true,
    }),
    false,
  );
  assert.equal(
    isMessageEligibleForReply({
      remoteJid: "120000000000000000@g.us",
      fromMe: false,
      groupAuthorized: false,
    }),
    false,
  );
});

test("replaces supported response variables in the configured timezone", () => {
  assert.equal(
    renderCommandResponse(
      "Olá {nome}, {grupo} — {data} às {hora}. {desconhecida}",
      {
        name: "Ana",
        group: "Comunidade",
        now: new Date("2026-07-15T15:04:00.000Z"),
        timezone: "America/Sao_Paulo",
      },
    ),
    "Olá Ana, Comunidade — 15/07/2026 às 12:04. {desconhecida}",
  );
});
