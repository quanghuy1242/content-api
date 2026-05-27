import type { ContentPrincipalDirectory } from "@/domain/iam/content-principal-directory";
import { ValidationError } from "@/shared/errors";
import { SCIM_ORG_ADMINS_GROUP_ID } from "@/shared/constants";

export type ScimContentPrincipalDirectoryConfig = {
  readonly idBaseUrl: string;
  readonly accessTokenProvider: {
    getAccessToken(): Promise<string>;
  };
  readonly fetchImpl?: typeof fetch;
};

/**
 * Path constants for `id`'s SCIM directory and OAuth client picker endpoints.
 */
const OAUTH_CLIENT_LOOKUP_PATH = "/api/auth/admin/oauth-clients/lookup";
const SCIM_V2 = "/api/auth/scim/v2";

export class ScimContentPrincipalDirectory implements ContentPrincipalDirectory {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ScimContentPrincipalDirectoryConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async validateUser(params: { userId: string }): Promise<void> {
    await this.get(`${SCIM_V2}/Users/${encodeURIComponent(params.userId)}`);
  }

  async validateUserInOrganization(params: { userId: string; orgId: string }): Promise<void> {
    await this.get(
      `${SCIM_V2}/tenants/${encodeURIComponent(params.orgId)}/Users/${encodeURIComponent(params.userId)}`,
    );
  }

  async validateTeamInOrganization(params: { teamId: string; orgId: string }): Promise<void> {
    await this.get(
      `${SCIM_V2}/tenants/${encodeURIComponent(params.orgId)}/Groups/${encodeURIComponent(params.teamId)}`,
    );
  }

  async validateServiceAccountForOrganization(params: {
    clientId: string;
    orgId: string;
    resource: string;
  }): Promise<void> {
    const url = new URL(OAUTH_CLIENT_LOOKUP_PATH, this.config.idBaseUrl);
    url.searchParams.set("client_id", params.clientId);
    url.searchParams.set("org_id", params.orgId);
    url.searchParams.set("resource", params.resource);
    await this.get(url.toString());
  }

  async validateOrganizationAdministrator(params: {
    userId: string;
    orgId: string;
  }): Promise<void> {
    const url = new URL(
      `${SCIM_V2}/tenants/${encodeURIComponent(params.orgId)}/Groups`,
      this.config.idBaseUrl,
    );
    url.searchParams.set(
      "filter",
      `id eq "${SCIM_ORG_ADMINS_GROUP_ID}" and members.value eq "${params.userId}"`,
    );
    const response = await this.getText(url.toString());
    const body = JSON.parse(response) as { totalResults?: number };
    if (!body.totalResults || body.totalResults === 0) {
      throw new ValidationError("Principal is not an organization administrator", { status: 404 });
    }
  }

  private async get(path: string): Promise<void> {
    const url = this.resolveUrl(path);
    const token = await this.config.accessTokenProvider.getAccessToken();
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/scim+json, application/json",
      },
    });
    if (!response.ok) {
      throw new ValidationError("SCIM principal directory lookup failed", {
        status: response.status,
      });
    }
  }

  private async getText(url: string): Promise<string> {
    const resolved = this.resolveUrl(url);
    const token = await this.config.accessTokenProvider.getAccessToken();
    const response = await this.fetchImpl(resolved, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/scim+json, application/json",
      },
    });
    if (!response.ok) {
      throw new ValidationError("SCIM principal directory lookup failed", {
        status: response.status,
      });
    }
    return response.text();
  }

  private resolveUrl(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    return new URL(path, this.config.idBaseUrl).toString();
  }
}
