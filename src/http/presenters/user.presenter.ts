import type { z } from "zod";
import type { Actor } from "@/domain/auth/actor";
import type { User } from "@/domain/users/user.entity";
import type { userResponseSchema } from "@/http/schemas/users.schema";

/**
 * Applies field-level presentation rules for user profiles. Authorization to
 * read the user is decided by policy; this presenter only hides sensitive
 * fields from non-admin/non-self actors per the documented response contract.
 */
export function presentUser(user: User, actor: Actor | null): z.infer<typeof userResponseSchema> {
  const isAdmin = actor?.type === "user" && actor.role === "admin";
  const isSelf = actor?.type === "user" && actor.id === user.id;

  return {
    id: user.id,
    fullName: user.fullName,
    avatar: user.avatar,
    bio: user.bio,
    email: isAdmin || isSelf ? user.email : null,
    role: isAdmin ? user.role : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
