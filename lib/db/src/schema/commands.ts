import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const commandsTable = pgTable(
  "commands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description").notNull(),
    responseContent: text("response_content").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("commands_active_name_idx").on(table.isActive, table.name)],
).enableRLS();

export const insertCommandSchema = createInsertSchema(commandsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCommand = z.infer<typeof insertCommandSchema>;
export type Command = typeof commandsTable.$inferSelect;
