import type { Actor, UserActor } from "@/domain/authz/actor";
import type { ContentRole } from "@/domain/iam/content-role.entity";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import {
  deriveDelegationClass,
  type ContentPermissionKey,
  type PrincipalRef,
} from "@/domain/iam/content-permission";
import type { ContentResourceRef } from "@/domain/iam/content-resource";
import type { PolicyBinding } from "@/domain/iam/policy-binding.entity";
import type { PolicyBindingRepository } from "@/domain/iam/policy-binding.repository";
import { ForbiddenError, ValidationError } from "@/shared/errors";

export class ContentAdministrationPolicy {
  constructor(
    private readonly contentPolicy: ContentPolicy,
    private readonly bindings: PolicyBindingRepository,
    private readonly rolePermissions: (roleId: string) => Promise<readonly ContentPermissionKey[]>,
  ) {}

  async authorizeBindingCreate(params: {
    actor: Actor;
    resource: ContentResourceRef;
    proposedRole: ContentRole;
    principal: PrincipalRef;
  }) {
    this.requireWorkspaceShareActor(params.actor, params.resource);
    if (params.proposedRole.id === "system:book.owner") {
      throw new ValidationError("Book ownership must be changed through ownership transfer");
    }
    if (!params.proposedRole.enabled) {
      throw new ValidationError("Disabled Content IAM roles cannot be assigned");
    }
    if (params.proposedRole.assignableResourceType !== params.resource.type) {
      throw new ValidationError("Role cannot be assigned to this resource type");
    }

    const permissions = await this.rolePermissions(params.proposedRole.id);
    const delegationClass = deriveDelegationClass(permissions);
    if (delegationClass !== "ordinary" && params.principal.type !== "user") {
      throw new ValidationError("Sensitive Content IAM roles can target direct users only");
    }
    if (delegationClass === "ownership_transfer" || delegationClass === "organization_admin") {
      throw new ValidationError("Sensitive Content IAM role requires a dedicated workflow");
    }
    if (delegationClass === "policy_management") {
      await this.requireProtectedBookManagementAuthority(params.actor, params.resource);
      return;
    }

    const requiredPermission = params.resource.type === "org" ? "org.manage_bindings" : "book.manage_bindings";
    await this.requireLocalPermission(params.actor, requiredPermission, params.resource);
  }

  async authorizeBindingRevoke(params: {
    actor: Actor;
    resource: ContentResourceRef;
    existingBinding: PolicyBinding;
  }) {
    this.requireWorkspaceShareActor(params.actor, params.resource);
    if (params.existingBinding.roleId === "system:book.owner") {
      throw new ValidationError("Book ownership must be changed through ownership transfer");
    }
    const permissions = await this.rolePermissions(params.existingBinding.roleId);
    if (
      params.existingBinding.roleId === "system:book.sharing_manager"
      || deriveDelegationClass(permissions) === "policy_management"
    ) {
      await this.requireProtectedBookManagementAuthority(params.actor, params.resource);
      return;
    }
    const requiredPermission = params.resource.type === "org" ? "org.manage_bindings" : "book.manage_bindings";
    await this.requireLocalPermission(params.actor, requiredPermission, params.resource);
  }

  async authorizeDenialMutation(params: {
    actor: Actor;
    resource: ContentResourceRef;
    permission: ContentPermissionKey;
    principal: PrincipalRef;
  }) {
    this.requireWorkspaceShareActor(params.actor, params.resource);
    if (deriveDelegationClass([params.permission]) !== "ordinary") {
      throw new ValidationError("Only ordinary permissions can be denied through resource sharing");
    }
    if (params.resource.type === "book" && params.principal.type === "user") {
      const isOwner = await this.contentPolicy.can({
        actor: {
          type: "user",
          id: params.principal.id,
          subject: params.principal.id,
          role: "user",
          scopes: params.actor.scopes,
          organizationId: params.resource.orgId,
          teamIds: [],
        },
        permission: "book.transfer_ownership",
        resource: params.resource,
      });
      if (isOwner) throw new ValidationError("Book owner permissions cannot be denied through sharing exceptions");
    }
    const requiredPermission = params.resource.type === "org" ? "org.manage_bindings" : "book.manage_bindings";
    await this.requireLocalPermission(params.actor, requiredPermission, params.resource);
  }

  async authorizeOwnershipTransfer(params: {
    actor: Actor;
    book: ContentResourceRef;
    currentOwnerUserId: string;
    nextOwnerUserId: string;
  }) {
    this.requireWorkspaceShareActor(params.actor, params.book);
    if (params.currentOwnerUserId === params.nextOwnerUserId) {
      throw new ValidationError("Next owner must differ from current owner");
    }
    await this.requireLocalPermission(params.actor, "book.transfer_ownership", params.book);
  }

  async authorizeRoleCompositionMutation(params: {
    actor: Actor;
    organization: ContentResourceRef;
    role: ContentRole;
    nextPermissions: readonly ContentPermissionKey[];
  }) {
    this.requireWorkspaceShareActor(params.actor, params.organization);
    if (params.role.builtIn) throw new ValidationError("Built-in roles are protected");
    if (deriveDelegationClass(params.nextPermissions) !== "ordinary") {
      throw new ValidationError("Custom roles can contain ordinary permissions only");
    }
    await this.requireLocalPermission(params.actor, "org.manage_roles", params.organization);
  }

  private requireWorkspaceShareActor(actor: Actor, resource: ContentResourceRef): asserts actor is UserActor {
    if (actor.type !== "user" || actor.organizationId !== resource.orgId || !actor.scopes.includes("content:share")) {
      throw new ForbiddenError("Content IAM mutation requires matching workspace context and content:share");
    }
  }

  private async requireLocalPermission(actor: Actor, permission: ContentPermissionKey, resource: ContentResourceRef) {
    const allowed = await this.contentPolicy.can({ actor, permission, resource });
    if (!allowed) throw new ForbiddenError("Content IAM mutation is not authorized by local policy");
  }

  private async requireProtectedBookManagementAuthority(actor: UserActor, resource: ContentResourceRef) {
    if (resource.type !== "book") {
      throw new ValidationError("Protected book management authority may be assigned only on books");
    }
    const now = new Date();
    const [directOwner, directOrganizationAdmin] = await Promise.all([
      this.bindings.hasActiveDirectUserRoleBinding({
        orgId: resource.orgId,
        userId: actor.subject,
        roleId: "system:book.owner",
        resourceType: "book",
        resourceId: resource.id,
        now,
      }),
      this.bindings.hasActiveDirectUserRoleBinding({
        orgId: resource.orgId,
        userId: actor.subject,
        roleId: "system:org.content_admin",
        resourceType: "org",
        resourceId: resource.orgId,
        now,
      }),
    ]);
    if (!directOwner && !directOrganizationAdmin) {
      throw new ForbiddenError("Protected sharing management requires a direct owner or organization content admin");
    }
  }
}
