import type { ContentPrincipalDirectory } from "@/domain/iam/content-principal-directory";
import { UnauthorizedError, ValidationError } from "@/shared/errors";

export type IdContentPrincipalDirectoryConfig = {
  readonly baseUrl: string;
  readonly accessTokenProvider: {
    getAccessToken(): Promise<string>;
  };
  readonly fetchImpl?: typeof fetch;
};

/**
 * Adapter for `id`'s low-volume principal validation API. It is used only by
 * durable Content IAM mutation use cases, never by hot-path policy checks.
 */
export class IdContentPrincipalDirectory implements ContentPrincipalDirectory {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: IdContentPrincipalDirectoryConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  validateUser(params: { userId: string }) {
    return this.post("/api/auth/principal-validation/users/validate", params);
  }

  validateUserInOrganization(params: { userId: string; orgId: string }) {
    return this.post("/api/auth/principal-validation/users/validate-organization-member", {
      userId: params.userId,
      organizationId: params.orgId,
    });
  }

  validateTeamInOrganization(params: { teamId: string; orgId: string }) {
    return this.post("/api/auth/principal-validation/teams/validate-organization-team", {
      teamId: params.teamId,
      organizationId: params.orgId,
    });
  }

  validateServiceAccountForOrganization(params: { clientId: string; orgId: string; resource: string }) {
    return this.post("/api/auth/principal-validation/service-accounts/validate-organization-grant", {
      clientId: params.clientId,
      organizationId: params.orgId,
      resource: params.resource,
    });
  }

  validateOrganizationAdministrator(params: { userId: string; orgId: string }) {
    return this.post("/api/auth/principal-validation/organization-administrators/validate", {
      userId: params.userId,
      organizationId: params.orgId,
    });
  }

  private async post(path: string, body: Record<string, string>): Promise<void> {
    const token = await this.config.accessTokenProvider.getAccessToken();
    const response = await this.fetchImpl(new URL(path, this.config.baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (response.status === 401) throw new UnauthorizedError("Principal validation caller token was rejected");
    if (!response.ok) throw new ValidationError("Principal validation failed", { status: response.status });
  }
}
