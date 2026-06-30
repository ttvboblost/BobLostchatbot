import { Router, type IRouter } from "express";
import { whatsappState } from "../whatsapp/state.js";
import { callWebhook } from "../whatsapp/bot.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// Actions and commands supported by this endpoint.
// Extend these sets to support future actions without changing the route logic.
const SUPPORTED_ACTIONS = new Set(["trigger_command"]);
const SUPPORTED_COMMANDS = new Set(["status"]);

router.post("/admin/action", async (req, res) => {
  logger.info("Requisição Admin recebida");

  try {
    // ── 1. Authenticate ──────────────────────────────────────────────────────
    const token = req.headers["x-admin-token"];
    const expectedToken = process.env["ADMIN_TOKEN"];

    if (!expectedToken || !token || token !== expectedToken) {
      logger.warn("Requisição Admin recusada — token inválido ou ausente");
      res.status(401).json({ success: false, message: "Não autorizado." });
      return;
    }

    // ── 2. Validate body fields ──────────────────────────────────────────────
    const body = req.body as Record<string, unknown>;
    const { action, command, groupId } = body;

    if (typeof action !== "string" || !SUPPORTED_ACTIONS.has(action)) {
      res
        .status(400)
        .json({ success: false, message: "Ação inválida ou não suportada." });
      return;
    }

    if (typeof command !== "string" || !SUPPORTED_COMMANDS.has(command)) {
      res
        .status(400)
        .json({ success: false, message: "Comando inválido ou não suportado." });
      return;
    }

    if (typeof groupId !== "string" || groupId.trim() === "") {
      res.status(400).json({ success: false, message: "groupId ausente ou inválido." });
      return;
    }

    // ── 3. Enforce TEST_GROUP_ID — never send to any other group ─────────────
    const testGroupId = process.env["TEST_GROUP_ID"];
    if (!testGroupId) {
      logger.error("TEST_GROUP_ID não configurado — requisição Admin bloqueada");
      res.status(503).json({ success: false, message: "Grupo de teste não configurado." });
      return;
    }

    if (groupId !== testGroupId) {
      logger.warn(
        { groupId },
        "Requisição Admin recusada — groupId não corresponde ao grupo de teste",
      );
      res
        .status(403)
        .json({ success: false, message: "groupId não autorizado." });
      return;
    }

    // ── 4. Ensure the bot is ready ───────────────────────────────────────────
    if (whatsappState.status !== "conectado") {
      res
        .status(503)
        .json({ success: false, message: "Bot desconectado. Aguarde a reconexão." });
      return;
    }

    const sock = whatsappState.sock;
    if (!sock) {
      res
        .status(503)
        .json({ success: false, message: "Socket WhatsApp indisponível." });
      return;
    }

    // ── 5. Execute via the exact same flow as an incoming message ────────────
    // Calls callWebhook() with "!<command>" exactly as the messages.upsert
    // handler does — no code duplication, no second implementation.
    const reply = await callWebhook(groupId, `!${command}`);

    if (reply) {
      await sock.sendMessage(groupId, { text: reply });
    }

    logger.info({ command }, `Comando interno executado: ${command}`);
    res.json({ success: true, message: "Comando executado." });
  } catch (err) {
    logger.error({ err }, "Erro ao processar requisição Admin");
    res.status(500).json({ success: false, message: "Erro interno do servidor." });
  }
});

export default router;
