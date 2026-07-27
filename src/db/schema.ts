import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * `tasks` — the demo table proving the full pipeline works end to end:
 * UI (src/app/tasks) -> API (src/app/api/tasks) -> Drizzle -> Neon Postgres.
 */
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
