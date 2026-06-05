import { Router, type IRouter } from "express";
import { whatsappState } from "../whatsapp/state.js";

const router: IRouter = Router();

router.get("/qr", (_req, res) => {
  const isConnected = whatsappState.status === "conectado";
  res.json({
    qr: isConnected ? null : whatsappState.qr,
    status: isConnected ? "connected" : "waiting",
  });
});

router.get("/status", (_req, res) => {
  const isConnected = whatsappState.status === "conectado";
  res.json({
    status: isConnected ? "connected" : "disconnected",
  });
});

export default router;
