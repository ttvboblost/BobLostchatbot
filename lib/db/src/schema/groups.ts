import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const authorizedGroupsTable = pgTable(
  "authorized_groups",
  {
    groupId: text("group_id").primaryKey(),
    groupName: text("group_name"),
    isAuthorized: boolean("is_authorized").notNull().default(false),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("authorized_groups_active_idx").on(table.isAuthorized),
    index("authorized_groups_name_idx").on(table.groupName),
  ],
).enableRLS();

export const insertAuthorizedGroupSchema = createInsertSchema(
  authorizedGroupsTable,
).omit({
  firstSeenAt: true,
  updatedAt: true,
});

export type InsertAuthorizedGroup = z.infer<typeof insertAuthorizedGroupSchema>;
export type AuthorizedGroup = typeof authorizedGroupsTable.$inferSelect;
