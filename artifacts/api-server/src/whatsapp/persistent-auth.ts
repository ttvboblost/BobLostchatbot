import {
  BufferJSON,
  initAuthCreds,
  type AuthenticationCreds,
  type AuthenticationState,
} from "@whiskeysockets/baileys";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  whatsappAuthKeysTable,
  whatsappSessionsTable,
} from "@workspace/db";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { createRequire } from "node:module";
import { logger } from "../lib/logger.js";

const SESSION_ID = "primary";
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_SALT = "boblost-whatsapp-session-v1";
let cachedEncryptionKey: Buffer | null = null;
const baileysRequire = createRequire(import.meta.url);
const { proto } = baileysRequire("@whiskeysockets/baileys") as {
  proto: {
    Message: {
      AppStateSyncKeyData: {
        fromObject(value: Record<string, unknown>): unknown;
      };
    };
  };
};

function safeErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown database error";
  return message
    .replace(
      /\b(password|token|secret|authorization|cookie|session)\b(\s*[:=]\s*)[^\s,;]+/gi,
      "$1$2[REDACTED]",
    )
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/\S+/gi, "[REDACTED_URL]")
    .slice(0, 500);
}

function isTransientAuthStoreError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code ?? "") : "";
  const message = safeErrorMessage(error);
  return (
    /^(08|40|57P0[1-3])/.test(code) ||
    ["ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNREFUSED"].includes(code) ||
    /connection terminated unexpectedly|connection terminated due to connection timeout|connection reset|server closed the connection/i.test(
      message,
    )
  );
}

export async function withAuthStoreRetry<T>(
  operation: string,
  run: () => Promise<T>,
): Promise<T> {
  const delays = [100, 300];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const details = {
        operation,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: safeErrorMessage(error),
        ...(typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (typeof error.code === "string" || typeof error.code === "number")
          ? { errorCode: String(error.code) }
          : {}),
      };
      if (!isTransientAuthStoreError(error) || attempt >= delays.length) {
        logger.error(
          { ...details, attempts: attempt + 1 },
          "Falha persistente no armazenamento das chaves do WhatsApp",
        );
        throw error;
      }
      logger.warn(
        { ...details, attempt: attempt + 1 },
        "Erro transitório no armazenamento das chaves; repetindo operação",
      );
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

function getEncryptionKey(): Buffer {
  if (cachedEncryptionKey) return cachedEncryptionKey;
  const secret = process.env["SESSION_SECRET"];
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  cachedEncryptionKey = scryptSync(secret, ENCRYPTION_SALT, 32);
  return cachedEncryptionKey;
}

function encrypt(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv);
  const serialized = JSON.stringify(value, BufferJSON.replacer);
  const ciphertext = Buffer.concat([
    cipher.update(serialized, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

function decrypt<T>(encrypted: string): T {
  const [version, ivText, tagText, ciphertextText] = encrypted.split(".");
  if (version !== "v1" || !ivText || !tagText || !ciphertextText) {
    throw new Error("Unsupported or malformed WhatsApp session ciphertext.");
  }
  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivText, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext, BufferJSON.reviver) as T;
}

export async function loadPersistentAuthState(): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const initialCreds = initAuthCreds();
  await withAuthStoreRetry("initialize_session", () =>
    db
      .insert(whatsappSessionsTable)
      .values({ id: SESSION_ID, encryptedCreds: encrypt(initialCreds) })
      .onConflictDoNothing(),
  );

  const [session] = await withAuthStoreRetry("load_session", () =>
    db
      .select()
      .from(whatsappSessionsTable)
      .where(eq(whatsappSessionsTable.id, SESSION_ID))
      .limit(1),
  );

  if (!session) throw new Error("Não foi possível carregar a sessão do WhatsApp.");

  const creds = session.encryptedCreds
    ? decrypt<AuthenticationCreds>(session.encryptedCreds)
    : initialCreds;

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        if (ids.length === 0) return {};

        const rows = await withAuthStoreRetry(`load_keys:${type}`, () =>
          db
            .select()
            .from(whatsappAuthKeysTable)
            .where(
              and(
                eq(whatsappAuthKeysTable.sessionId, SESSION_ID),
                eq(whatsappAuthKeysTable.keyType, type),
                inArray(whatsappAuthKeysTable.keyId, ids),
              ),
            ),
        );

        const values: Record<string, unknown> = {};
        for (const row of rows) {
          const value = decrypt<unknown>(row.encryptedValue);
          values[row.keyId] =
            type === "app-state-sync-key" && value
              ? proto.Message.AppStateSyncKeyData.fromObject(
                  value as Record<string, unknown>,
                )
              : value;
        }
        return values as never;
      },
      set: async (data) => {
        await withAuthStoreRetry("save_keys", () =>
          db.transaction(async (transaction) => {
            for (const [type, entries] of Object.entries(data)) {
              for (const [keyId, value] of Object.entries(entries)) {
                const condition = and(
                  eq(whatsappAuthKeysTable.sessionId, SESSION_ID),
                  eq(whatsappAuthKeysTable.keyType, type),
                  eq(whatsappAuthKeysTable.keyId, keyId),
                );

                if (value === null || value === undefined) {
                  await transaction
                    .delete(whatsappAuthKeysTable)
                    .where(condition);
                  continue;
                }

                await transaction
                  .insert(whatsappAuthKeysTable)
                  .values({
                    sessionId: SESSION_ID,
                    keyType: type,
                    keyId,
                    encryptedValue: encrypt(value),
                  })
                  .onConflictDoUpdate({
                    target: [
                      whatsappAuthKeysTable.sessionId,
                      whatsappAuthKeysTable.keyType,
                      whatsappAuthKeysTable.keyId,
                    ],
                    set: { encryptedValue: encrypt(value) },
                  });
              }
            }
          }),
        );
      },
    },
  };

  return {
    state,
    saveCreds: async () => {
      await withAuthStoreRetry("save_credentials", () =>
        db
          .update(whatsappSessionsTable)
          .set({
            encryptedCreds: encrypt(state.creds),
            updatedAt: new Date(),
          })
          .where(eq(whatsappSessionsTable.id, SESSION_ID)),
      );
    },
  };
}

export async function updateWhatsAppSessionStatus(
  connected: boolean,
): Promise<void> {
  await withAuthStoreRetry("update_connection_status", () =>
    db
      .update(whatsappSessionsTable)
      .set({ connected, updatedAt: new Date() })
      .where(eq(whatsappSessionsTable.id, SESSION_ID)),
  );
}

export async function deletePersistentAuthState(): Promise<void> {
  await db
    .delete(whatsappSessionsTable)
    .where(eq(whatsappSessionsTable.id, SESSION_ID));
}
