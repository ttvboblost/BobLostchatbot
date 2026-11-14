import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const afkStatusesTable = pgTable(
  "afk_statuses",
  {
    groupId: text("group_id").notNull(),
    userJid: text("user_jid").notNull(),
    reason: text("reason").notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.groupId, table.userJid],
      name: "afk_statuses_group_user_pk",
    }),
    index("afk_statuses_user_idx").on(table.userJid),
  ],
).enableRLS();

export const processedMessageEventsTable = pgTable(
  "processed_message_events",
  {
    groupId: text("group_id").notNull(),
    messageId: text("message_id").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.groupId, table.messageId],
      name: "processed_message_events_group_message_pk",
    }),
    index("processed_message_events_processed_at_idx").on(table.processedAt),
  ],
).enableRLS();

export type AfkStatus = typeof afkStatusesTable.$inferSelect;
