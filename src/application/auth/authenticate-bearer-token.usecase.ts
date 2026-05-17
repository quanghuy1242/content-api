import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import type { JWTPayload } from "jose";
import type { Actor } from "@/domain/authz/actor";
import type { UserRepository } from "@/domain/users/user.repository";
import { UnauthorizedError } from "@/shared/errors";

type AuthConfig = {
  issuer: string;
  audience: string;
  jwksUrl: string;
  fetchImpl?: typeof fetch;
};

type VerifiedToken = JWTPayload & {
  token_use?: string;
  email?: string;
  roles?: string[];
};

/**
 * OAuth2 resource-server boundary for Auther access tokens.
 *
 * The use case validates bearer JWTs with the configured remote JWKS, issuer,
 * audience, expiry, and `token_use=access` before mapping the external subject
 * to a local actor. It intentionally lives in application code because authn is
 * workflow logic, while resource-specific authorization stays in policies.
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
    if (verified.token_use !== "access") {
      throw new UnauthorizedError("Invalid token");
    }
    if (typeof verified.sub !== "string" || !verified.sub) {
      throw new UnauthorizedError("Invalid token");
    }

    const localUser = await this.users.findByBetterAuthUserId(verified.sub);
    const role = verified.roles?.includes("admin") || localUser?.role === "admin" ? "admin" : "user";

    return {
      type: "user",
      id: localUser?.id ?? verified.sub,
      localUserId: localUser?.id,
      externalId: verified.sub,
      role,
      email: typeof verified.email === "string" ? verified.email : undefined,
    };
  }
}
