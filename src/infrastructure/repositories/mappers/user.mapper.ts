import { User } from "@/domain/users/user.entity";
import { users } from "@/infrastructure/db/schema";

type UserRow = typeof users.$inferSelect;

/**
 * Rebuilds a user entity from a Drizzle row.
 */
export function userRowToEntity(row: UserRow): User {
  return User.reconstitute({
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    avatar: row.avatar,
    bio: row.bioJson ?? null,
    role: row.role as "admin" | "user",
    betterAuthUserId: row.betterAuthUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/**
 * Converts a domain user entity to the persisted column names.
 */
export function userToInsertRow(user: User) {
  const snap = user.toSnapshot();
  return {
    id: snap.id,
    email: snap.email,
    fullName: snap.fullName,
    avatar: snap.avatar,
    bioJson: snap.bio,
    role: snap.role,
    betterAuthUserId: snap.betterAuthUserId,
    createdAt: snap.createdAt,
    updatedAt: snap.updatedAt,
  };
}

/**
 * Converts a domain user entity to an update payload.
 */
export function userToUpdateRow(user: User) {
  const snap = user.toSnapshot();
  return {
    email: snap.email,
    fullName: snap.fullName,
    avatar: snap.avatar,
    bioJson: snap.bio,
    role: snap.role,
    updatedAt: snap.updatedAt,
  };
}
