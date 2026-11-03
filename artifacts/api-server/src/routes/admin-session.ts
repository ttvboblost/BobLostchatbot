import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  adminLoginRateLimit,
  adminRateLimit,
  isAdminTokenValid,
  requireAdmin,
} from "../middlewares/admin-auth.js";
import {
  clearAdminSessionCookie,
  getAdminSessionExpiry,
  setAdminSessionCookie,
} from "../middlewares/admin-session.js";

const router: IRouter = Router();
const loginSchema = z.object({ token: z.string().min(1).max(512) }).strict();

router.post("/login", adminLoginRateLimit, (req, res): void => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success || !isAdminTokenValid(parsed.data.token)) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Token administrativo inválido." },
    });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  const expiresAt = setAdminSessionCookie(res);
  res.json({
    success: true,
    data: { authenticated: true, expiresAt },
  });
});

router.get("/", adminRateLimit, requireAdmin, (req, res): void => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    success: true,
    data: { authenticated: true, expiresAt: getAdminSessionExpiry(req) },
  });
});

router.post("/logout", adminRateLimit, requireAdmin, (_req, res): void => {
  clearAdminSessionCookie(res);
  res.json({ success: true, data: { loggedOut: true } });
});

export default router;
