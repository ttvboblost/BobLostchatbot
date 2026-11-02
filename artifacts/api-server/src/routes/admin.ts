import { Router, type IRouter } from "express";
import QRCode from "qrcode";
import { startWhatsAppBot, disconnectWhatsApp } from "../whatsapp/bot.js";
import { whatsappState } from "../whatsapp/state.js";

const router: IRouter = Router();

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
      data: { status: "connected", qr: null, qrSvg: null, timestamp: null },
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
    },
  });
});

router.post("/whatsapp/connect", async (_req, res): Promise<void> => {
  await startWhatsAppBot();
  res.status(202).json({
    success: true,
    data: {
      status: whatsappState.status,
      message: "Conexão com o WhatsApp iniciada ou já em andamento.",
    },
  });
});

router.post("/whatsapp/disconnect", async (_req, res): Promise<void> => {
  await disconnectWhatsApp();
  res.json({
    success: true,
    data: { status: "disconnected", message: "WhatsApp desconectado." },
  });
});

export default router;
