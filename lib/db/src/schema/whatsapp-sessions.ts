import {
  boolean,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const whatsappSessionsTable = pgTable("whatsapp_sessions", {
  id: text("id").primaryKey().default("primary"),
  encryptedCreds: text("encrypted_creds"),
  connected: boolean("connected").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();

export const whatsappAuthKeysTable = pgTable(
  "whatsapp_auth_keys",
  {
    sessionId: text("session_id").notNull(),
    keyType: text("key_type").notNull(),
    keyId: text("key_id").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.sessionId, table.keyType, table.keyId],
      name: "whatsapp_auth_keys_pk",
    }),
    foreignKey({
      columns: [table.sessionId],
      foreignColumns: [whatsappSessionsTable.id],
      name: "whatsapp_auth_keys_session_fk",
    }).onDelete("cascade"),
    index("whatsapp_auth_keys_type_idx").on(table.sessionId, table.keyType),
  ],
).enableRLS();
