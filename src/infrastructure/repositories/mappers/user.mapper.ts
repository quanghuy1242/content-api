import type { User } from "@/domain/users/user.entity";
import { users } from "@/infrastructure/db/schema";

type UserRow = typeof users.$inferSelect;

/**
 * Rehydrates a user row and maps the persisted JSON bio column to the domain
 * field used by policies and presenters.
 */
export function userRowToEntity(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    avatar: row.avatar,
    bio: row.bioJson ?? null,
    role: row.role as "admin" | "user",
    betterAuthUserId: row.betterAuthUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Converts a domain user create payload to the persisted column names.
 */
export function userToInsertRow(input: Omit<User, "createdAt" | "updatedAt">) {
  return {
    id: input.id,
    email: input.email,
    fullName: input.fullName,
    avatar: input.avatar,
    bioJson: input.bio,
    role: input.role,
    betterAuthUserId: input.betterAuthUserId,
  };
}

/**
 * Converts user PATCH input to persistence columns and owns the update clock.
 */
export function userToUpdateRow(input: Partial<Omit<User, "id" | "createdAt" | "updatedAt">>) {
  return {
    email: input.email,
    fullName: input.fullName,
    avatar: input.avatar,
    bioJson: input.bio,
    role: input.role,
    updatedAt: new Date(),
  };
}
