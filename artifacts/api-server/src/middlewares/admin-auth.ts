import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

const requestCounts = new Map<string, { count: number; resetsAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 120;

export function isAdminTokenValid(candidate: string): boolean {
  const expected = process.env["ADMIN_TOKEN"];
  if (!expected || expected.length < 32 || !candidate) return false;

  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return (
    candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes)
  );
}

export const adminRateLimit: RequestHandler = (req, res, next) => {
  const now = Date.now();
  const key = req.ip ?? "unknown";
  const current = requestCounts.get(key);

  if (!current || current.resetsAt <= now) {
    requestCounts.set(key, { count: 1, resetsAt: now + WINDOW_MS });
    next();
    return;
  }

  current.count += 1;
  if (current.count > MAX_REQUESTS) {
    res.status(429).json({
      success: false,
      error: { code: "RATE_LIMITED", message: "Limite de requisições excedido." },
    });
    return;
  }

  if (requestCounts.size > 5000) {
    for (const [clientIp, entry] of requestCounts) {
      if (entry.resetsAt <= now) requestCounts.delete(clientIp);
    }
  }
  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  const authorization = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);

  if (!match || !isAdminTokenValid(match[1] ?? "")) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Autenticação administrativa necessária." },
    });
    return;
  }

  next();
};
