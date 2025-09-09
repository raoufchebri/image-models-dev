import { integer, pgTable, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";

export const usersTable = pgTable("generations", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: varchar({ length: 255 }),
    prompt: varchar({ length: 255 }).notNull(),
    inputImageUrl: varchar({ length: 255 }).notNull(),
    outputImageUrl: varchar({ length: 255 }).notNull(),
    model: varchar({ length: 255 }).notNull(),
    status: varchar({ length: 255 }).notNull(),
    error: varchar({ length: 255 }).notNull(),
    metadata: jsonb().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
  });