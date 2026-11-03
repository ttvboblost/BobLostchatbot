import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

export const ADMIN_SESSION_COOKIE_NAME = "boblost_admin_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function getSessionSecret(): string {
  const secret = process.env["SESSION_SECRET"];
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
}

function readCookieValue(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === ADMIN_SESSION_COOKIE_NAME) {
      return part.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

function readExpiry(cookieHeader: string | undefined): number | null {
  const value = readCookieValue(cookieHeader);
  if (!value) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return null;

  const expected = Buffer.from(sign(payload));
  const provided = Buffer.from(signature);
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return null;
  }

  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("exp" in decoded) ||
      typeof decoded.exp !== "number" ||
      !Number.isSafeInteger(decoded.exp)
    ) {
      return null;
    }
    return decoded.exp > Date.now() ? decoded.exp : null;
  } catch {
    return null;
  }
}

export function getAdminSessionExpiry(req: Request): string | null {
  const expiry = readExpiry(req.headers.cookie);
  return expiry === null ? null : new Date(expiry).toISOString();
}

export function hasValidAdminSession(req: Request): boolean {
  return readExpiry(req.headers.cookie) !== null;
}

export function setAdminSessionCookie(res: Response): string {
  const expiry = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = Buffer.from(JSON.stringify({ exp: expiry })).toString(
    "base64url",
  );
  const cookieValue = `${payload}.${sign(payload)}`;
  const secure =
    process.env["NODE_ENV"] === "production" ||
    Boolean(process.env["REPLIT_DEV_DOMAIN"]);
  const secureAttribute = secure ? "; Secure" : "";

  res.setHeader(
    "Set-Cookie",
    `${ADMIN_SESSION_COOKIE_NAME}=${cookieValue}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secureAttribute}`,
  );
  return new Date(expiry).toISOString();
}

export function clearAdminSessionCookie(res: Response): void {
  const secure =
    process.env["NODE_ENV"] === "production" ||
    Boolean(process.env["REPLIT_DEV_DOMAIN"]);
  const secureAttribute = secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${ADMIN_SESSION_COOKIE_NAME}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secureAttribute}`,
  );
}
