import type { Actor } from "@/domain/authz/actor";
import type { ContentPermissionKey, PrincipalRef } from "@/domain/iam/content-permission";
import { bindingRefsForResource, type ContentResourceRef } from "@/domain/iam/content-resource";
import type { PolicyBindingRepository } from "@/domain/iam/policy-binding.repository";
import type { PolicyDenialRepository } from "@/domain/iam/policy-denial.repository";

export interface ContentPolicy {
  can(params: { actor: Actor | null; permission: ContentPermissionKey; resource: ContentResourceRef }): Promise<boolean>;
  canMany(params: {
    actor: Actor | null;
    permission: ContentPermissionKey;
    resources: readonly ContentResourceRef[];
  }): Promise<Map<string, boolean>>;
}

/**
 * Local Content IAM evaluator. It expands signed `id` actor claims into local
 * principals, checks denials first, then checks DB-backed role bindings.
 */
export class LocalContentPolicy implements ContentPolicy {
  constructor(
    private readonly bindings: PolicyBindingRepository,
    private readonly denials: PolicyDenialRepository,
  ) {}

  async can(params: { actor: Actor | null; permission: ContentPermissionKey; resource: ContentResourceRef }) {
    const principals = principalsForActor(params.actor, params.resource.orgId);
    if (principals.length === 0) return false;

    const resources = bindingRefsForResource(params.resource);
    const denied = await this.denials.hasActiveDenial({
      orgId: params.resource.orgId,
      principals,
      permission: params.permission,
      resources,
      now: new Date(),
    });
    if (denied) return false;

    return this.bindings.hasAllowedPermission({
      orgId: params.resource.orgId,
      principals,
      permission: params.permission,
      resources,
      now: new Date(),
    });
  }

  async canMany(params: {
    actor: Actor | null;
    permission: ContentPermissionKey;
    resources: readonly ContentResourceRef[];
  }) {
    const decisions = await Promise.all(params.resources.map(async (resource) => ({
      id: resource.id,
      allowed: await this.can({ actor: params.actor, permission: params.permission, resource }),
    })));
    return new Map(decisions.map((decision) => [decision.id, decision.allowed]));
  }
}

export function principalsForActor(actor: Actor | null, resourceOrgId: string): PrincipalRef[] {
  if (!actor) return [];
  if (actor.type === "service_account") {
    return actor.organizationId === resourceOrgId ? [{ type: "service_account", id: actor.clientId }] : [];
  }
  if (actor.type !== "user") return [];
  if (actor.organizationId && actor.organizationId !== resourceOrgId) return [];
  const principals: PrincipalRef[] = [{ type: "user", id: actor.subject }];
  if (actor.organizationId === resourceOrgId) {
    principals.push(...actor.teamIds.map((teamId) => ({ type: "team" as const, id: teamId })));
  }
  return principals;
}
