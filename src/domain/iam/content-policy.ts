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
    const decisions = new Map(params.resources.map((resource) => [resource.id, false]));
    const resourcesByOrg = new Map<string, ContentResourceRef[]>();
    for (const resource of params.resources) {
      resourcesByOrg.set(resource.orgId, [...(resourcesByOrg.get(resource.orgId) ?? []), resource]);
    }

    await Promise.all([...resourcesByOrg].map(async ([orgId, resources]) => {
      const principals = principalsForActor(params.actor, orgId);
      if (principals.length === 0) return;

      const refs = uniqueBindingRefs(resources.flatMap(bindingRefsForResource));
      const [deniedRefs, allowedRefs] = await Promise.all([
        this.denials.findDeniedResourceRefs({
          orgId,
          principals,
          permission: params.permission,
          resources: refs,
          now: new Date(),
        }),
        this.bindings.findAllowedResourceRefs({
          orgId,
          principals,
          permission: params.permission,
          resources: refs,
          now: new Date(),
        }),
      ]);
      const denied = refKeySet(deniedRefs);
      const allowed = refKeySet(allowedRefs);
      for (const resource of resources) {
        const resourceRefs = bindingRefsForResource(resource);
        const isDenied = resourceRefs.some((ref) => denied.has(refKey(ref)));
        const isAllowed = resourceRefs.some((ref) => allowed.has(refKey(ref)));
        decisions.set(resource.id, !isDenied && isAllowed);
      }
    }));

    return decisions;
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

function uniqueBindingRefs(resources: readonly ReturnType<typeof bindingRefsForResource>[number][]) {
  const keyed = new Map<string, ReturnType<typeof bindingRefsForResource>[number]>();
  for (const resource of resources) {
    keyed.set(refKey(resource), resource);
  }
  return [...keyed.values()];
}

function refKeySet(resources: readonly ReturnType<typeof bindingRefsForResource>[number][]) {
  return new Set(resources.map(refKey));
}

function refKey(resource: ReturnType<typeof bindingRefsForResource>[number]) {
  return `${resource.type}:${resource.id}`;
}
