import { Router, type IRouter } from "express";
import QRCode from "qrcode";
import { adminRateLimit, requireAdmin } from "../middlewares/admin-auth.js";
import { whatsappState } from "../whatsapp/state.js";

const router: IRouter = Router();

router.get("/status", (_req, res) => {
  res.json({
    success: true,
    data: {
      status: whatsappState.status,
      connected: whatsappState.status === "connected",
    },
  });
});

router.get("/qr", adminRateLimit, requireAdmin, async (_req, res): Promise<void> => {
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
    ? await QRCode.toString(qr, {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M",
      })
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

export default router;
