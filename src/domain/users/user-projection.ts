import type { UserActor } from "@/domain/authz/actor";
import type { IdentityProjectionUserProps } from "@/domain/users/user.entity";

export function identityProjectionFromActor(actor: UserActor): IdentityProjectionUserProps {
  const email = actor.email ?? `${actor.subject}@id.local.invalid`;
  return {
    id: actor.subject,
    email,
    fullName: actor.name ?? email,
    avatar: actor.avatar ?? null,
  };
}
