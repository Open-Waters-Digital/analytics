import { timestamp } from "drizzle-orm/pg-core";

/** Every table has these (AGENTS.md → Schema and data-layer conventions). */
export const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
