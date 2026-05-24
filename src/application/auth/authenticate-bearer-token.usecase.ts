import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from "jose";
import type { Actor } from "@/domain/authz/actor";
import { hasAnyContentScope } from "@/domain/authz/scopes";
import type { UserRepository } from "@/domain/users/user.repository";
import { UnauthorizedError } from "@/shared/errors";

type AuthConfig = {
  issuer: string;
  audience: string;
  jwksUrl: string;
  requiredScope: string;
  fetchImpl?: typeof fetch;
};

type VerifiedToken = JWTPayload & {
  email?: string;
  name?: string;
  picture?: string;
  scope?: string;
  org_id?: string;
  team_ids?: unknown;
  azp?: string;
  client_id?: string;
};

/**
 * OAuth2 resource-server boundary for `id` access tokens.
 *
 * The use case validates bearer JWTs with the configured remote JWKS, issuer,
 * audience, expiry, and coarse scope before building a content-api actor.
 * Object authorization remains local policy state and never queries `id`.
 */
export class AuthenticateBearerTokenUseCase {
  private readonly jwks;

  constructor(
    private readonly config: AuthConfig,
    private readonly users: UserRepository,
  ) {
    this.jwks = createRemoteJWKSet(new URL(config.jwksUrl), {
      [customFetch]: config.fetchImpl ?? fetch,
    });
  }

  async execute(header: string | null): Promise<Actor> {
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedError("Missing bearer token");
    }

    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      throw new UnauthorizedError("Missing bearer token");
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience,
      }));
    } catch {
      throw new UnauthorizedError("Invalid token");
    }

    const verified = payload as VerifiedToken;
    const scopes = parseScopes(verified.scope);
    if (!hasAnyContentScope(scopes, parseScopes(this.config.requiredScope))) {
      throw new UnauthorizedError("Invalid token");
    }

    if (typeof verified.sub === "string" && verified.sub) {
      return this.buildUserActor(verified, scopes);
    }

    return this.buildServiceAccountActor(verified, scopes);
  }

  private async buildUserActor(verified: VerifiedToken, scopes: readonly string[]): Promise<Actor> {
    const subject = verified.sub ?? "";
    const organizationId = typeof verified.org_id === "string" && verified.org_id ? verified.org_id : undefined;
    const teamIds = parseTeamIds(verified.team_ids);

    if (!organizationId) {
      if (teamIds.length > 0 || scopes.includes("content:share")) {
        throw new UnauthorizedError("Invalid token");
      }
    }

    const localUser = await this.users.findById(subject);
    const role = localUser?.role === "admin" ? "admin" : "user";

    return {
      type: "user",
      id: subject,
      subject,
      role,
      scopes,
      organizationId,
      teamIds,
      email: typeof verified.email === "string" ? verified.email : undefined,
      name: typeof verified.name === "string" ? verified.name : undefined,
      avatar: typeof verified.picture === "string" ? verified.picture : undefined,
    };
  }

  private buildServiceAccountActor(verified: VerifiedToken, scopes: readonly string[]): Actor {
    const clientId = typeof verified.azp === "string" && verified.azp ? verified.azp : verified.client_id;
    if (typeof clientId !== "string" || !clientId) {
      throw new UnauthorizedError("Invalid token");
    }
    if (typeof verified.org_id !== "string" || !verified.org_id) {
      throw new UnauthorizedError("Invalid token");
    }

    return {
      type: "service_account",
      clientId,
      organizationId: verified.org_id,
      scopes,
    };
  }
}

function parseScopes(scope: unknown): string[] {
  return typeof scope === "string" ? scope.split(" ").filter(Boolean) : [];
}

function parseTeamIds(teamIds: unknown): string[] {
  if (!Array.isArray(teamIds)) return [];
  return teamIds.filter((teamId): teamId is string => typeof teamId === "string" && teamId.length > 0);
}
