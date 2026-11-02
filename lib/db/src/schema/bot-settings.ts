import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const botSettingsTable = pgTable("bot_settings", {
  id: text("id").primaryKey().default("primary"),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  liveIntegrationConfig: jsonb("live_integration_config"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}).enableRLS();
