import type { Actor } from "@/domain/authz/actor";
import { requireContentScope } from "@/domain/authz/scopes";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import type { ContentPermissionKey } from "@/domain/iam/content-permission";
import type { ContentRole } from "@/domain/iam/content-role.entity";
import type { ContentRoleRepository } from "@/domain/iam/content-role.repository";
import { ForbiddenError } from "@/shared/errors";
import { organizationResource } from "@/domain/iam/resource-loader";

export type ContentRoleWithPermissions = {
  role: ContentRole;
  permissions: readonly ContentPermissionKey[];
};

export class ListContentRolesUseCase {
  constructor(
    private readonly roles: ContentRoleRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: { actor: Actor; orgId: string; limit: number; cursor?: string }) {
    requireContentScope(params.actor, "content:share");
    await this.roles.ensureSystemCatalog();
    const resource = organizationResource(params.orgId);
    const allowed = await this.contentPolicy.can({
      actor: params.actor,
      permission: "org.manage_roles",
      resource,
    });
    if (!allowed) throw new ForbiddenError("Not authorized to list content roles");

    const page = await this.roles.findMany({
      namespaceIds: ["system", params.orgId],
      limit: params.limit,
      cursor: params.cursor,
    });
    return {
      data: await Promise.all(page.data.map((role) => this.withPermissions(role))),
      page: page.page,
    };
  }

  private async withPermissions(role: ContentRole): Promise<ContentRoleWithPermissions> {
    return {
      role,
      permissions: await this.roles.findPermissionKeys(role.id),
    };
  }
}
