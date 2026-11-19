import { Router, type IRouter, type Response } from "express";
import { eq, gte, sql } from "drizzle-orm";
import QRCode from "qrcode";
import {
  disconnectWhatsApp,
  ownsWhatsAppSessionProcess,
  restartWhatsApp,
  startWhatsAppBot,
  unlinkWhatsApp,
} from "../whatsapp/bot.js";
import { whatsappState } from "../whatsapp/state.js";
import {
  authorizedGroupsTable,
  commandLogsTable,
  commandsTable,
  db,
} from "@workspace/db";
import { recordAdminAudit } from "../lib/admin-audit.js";

const router: IRouter = Router();

function requireWhatsAppOwner(
  res: Response,
): boolean {
  if (ownsWhatsAppSessionProcess()) return true;
  res.status(409).json({
    success: false,
    error: {
      code: "WHATSAPP_INSTANCE_NOT_OWNER",
      message:
        "Esta instância não controla a sessão WhatsApp. Aguarde o processo ativo ou tente novamente.",
    },
  });
  return false;
}

router.get("/overview", async (_req, res): Promise<void> => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [commands, activeCommands, groups, recentCommands] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(commandsTable),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(commandsTable)
      .where(eq(commandsTable.isActive, true)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(authorizedGroupsTable)
      .where(eq(authorizedGroupsTable.isAuthorized, true)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(commandLogsTable)
      .where(gte(commandLogsTable.createdAt, since)),
  ]);

  res.json({
    success: true,
    data: {
      status: whatsappState.status,
      connected: whatsappState.status === "connected",
      qrAvailable:
        whatsappState.status === "waiting_qr" &&
        Boolean(whatsappState.qr) &&
        !whatsappState.qrExpired,
      qrUpdatedAt: whatsappState.qrTimestamp
        ? new Date(whatsappState.qrTimestamp).toISOString()
        : null,
      qrExpiresAt: whatsappState.qrExpiresAt
        ? new Date(whatsappState.qrExpiresAt).toISOString()
        : null,
      lastError: whatsappState.lastError,
      commandCount: commands[0]?.count ?? 0,
      activeCommandCount: activeCommands[0]?.count ?? 0,
      authorizedGroupCount: groups[0]?.count ?? 0,
      recentCommandCount: recentCommands[0]?.count ?? 0,
    },
  });
});

router.get("/whatsapp", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    success: true,
    data: {
      status: whatsappState.status,
      connected: whatsappState.status === "connected",
      qrAvailable:
        whatsappState.status === "waiting_qr" && Boolean(whatsappState.qr),
      qrUpdatedAt: whatsappState.qrTimestamp
        ? new Date(whatsappState.qrTimestamp).toISOString()
        : null,
      qrExpiresAt: whatsappState.qrExpiresAt
        ? new Date(whatsappState.qrExpiresAt).toISOString()
        : null,
      lastError: whatsappState.lastError,
    },
  });
});

router.get("/whatsapp/qr", async (_req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (whatsappState.status === "connected") {
    res.json({
      success: true,
      data: {
        status: "connected",
        qr: null,
        qrSvg: null,
        timestamp: null,
        expiresAt: null,
        expired: false,
      },
    });
    return;
  }

  const qr = whatsappState.qr;
  const qrSvg = qr
    ? await QRCode.toString(qr, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
    : null;
  res.json({
    success: true,
    data: {
      status: whatsappState.status,
      qr,
      qrSvg,
      timestamp: whatsappState.qrTimestamp
        ? new Date(whatsappState.qrTimestamp).toISOString()
        : null,
      expiresAt: whatsappState.qrExpiresAt
        ? new Date(whatsappState.qrExpiresAt).toISOString()
        : null,
      expired: whatsappState.qrExpired,
    },
  });
});

router.post("/whatsapp/connect", async (_req, res): Promise<void> => {
  await startWhatsAppBot();
  await recordAdminAudit({
    action: "whatsapp.connect",
    resourceType: "whatsapp_session",
  });
  res.status(202).json({
    success: true,
    data: {
      status: whatsappState.status,
      message:
        whatsappState.lastError ??
        "Conexão com o WhatsApp iniciada ou já em andamento.",
    },
  });
});

router.post("/whatsapp/disconnect", async (_req, res): Promise<void> => {
  if (!requireWhatsAppOwner(res)) return;
  await disconnectWhatsApp();
  await recordAdminAudit({
    action: "whatsapp.disconnect",
    resourceType: "whatsapp_session",
    metadata: { credentialsPreserved: true },
  });
  res.json({
    success: true,
    data: {
      status: "disconnected",
      message: "WhatsApp desconectado; sessão preservada.",
    },
  });
});

router.post("/whatsapp/restart", async (_req, res): Promise<void> => {
  if (!requireWhatsAppOwner(res)) return;
  await restartWhatsApp();
  await recordAdminAudit({
    action: "whatsapp.restart",
    resourceType: "whatsapp_session",
    metadata: { credentialsPreserved: true },
  });
  res.status(202).json({
    success: true,
    data: { status: whatsappState.status, message: "Reconexão iniciada." },
  });
});

router.post("/whatsapp/unlink", async (_req, res): Promise<void> => {
  if (!requireWhatsAppOwner(res)) return;
  await unlinkWhatsApp();
  await recordAdminAudit({
    action: "whatsapp.unlink",
    resourceType: "whatsapp_session",
    metadata: { credentialsDeleted: true },
  });
  res.json({
    success: true,
    data: { status: "disconnected", message: "Sessão removida." },
  });
});

export default router;
