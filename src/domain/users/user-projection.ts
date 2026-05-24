import type { UserActor } from "@/domain/authz/actor";
import type { IdentityProjectionUserProps } from "@/domain/users/user.entity";

export function identityProjectionFromActor(actor: UserActor): IdentityProjectionUserProps {
  return {
    id: actor.subject,
    email: actor.email,
    fullName: actor.name,
    avatar: actor.avatar,
  };
}
