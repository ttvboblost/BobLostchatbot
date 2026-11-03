import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const adminAuditLogsTable = pgTable(
  "admin_audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("admin_audit_logs_created_idx").on(table.createdAt),
    index("admin_audit_logs_resource_idx").on(table.resourceType, table.resourceId),
  ],
).enableRLS();

export type AdminAuditLog = typeof adminAuditLogsTable.$inferSelect;
