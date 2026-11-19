import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { commandsTable } from "./commands.js";

export const commandLogsTable = pgTable(
  "command_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    commandId: uuid("command_id").references(() => commandsTable.id, {
      onDelete: "set null",
    }),
    commandName: text("command_name").notNull(),
    groupId: text("group_id").notNull(),
    senderJid: text("sender_jid"),
    status: text("status").notNull(),
    errorName: text("error_name"),
    errorMessage: text("error_message"),
    errorCode: text("error_code"),
    errorStatusCode: integer("error_status_code"),
    errorContext: jsonb("error_context").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("command_logs_created_at_idx").on(table.createdAt),
    index("command_logs_group_created_idx").on(table.groupId, table.createdAt),
    index("command_logs_name_created_idx").on(table.commandName, table.createdAt),
  ],
).enableRLS();

export type CommandLog = typeof commandLogsTable.$inferSelect;
