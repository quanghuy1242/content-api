import type { IntrospectPresentedToken, IntrospectionResult } from "@/domain/auth/introspection-port";
import { UnauthorizedError } from "@/shared/errors";

export type IdIntrospectionAdapterConfig = {
  readonly idIntrospectionUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetchImpl?: typeof fetch;
};

/** RFC 7662 token introspection endpoint on `id`. */
const INTROSPECT_PATH = "/api/auth/oauth2/introspect";

/**
 * RFC 7662 adapter. Authenticates to `id` via HTTP Basic auth using the
 * content-api M2M credentials, then introspects the presented token.
 */
export class IdIntrospectionAdapter implements IntrospectPresentedToken {
  private readonly fetchImpl: typeof fetch;
  private readonly authorization: string;

  constructor(private readonly config: IdIntrospectionAdapterConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.authorization = `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
  }

  async introspect(token: string): Promise<IntrospectionResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        new URL(INTROSPECT_PATH, this.config.idIntrospectionUrl),
        {
          method: "POST",
          headers: {
            authorization: this.authorization,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ token }),
        },
      );
    } catch {
      throw new UnauthorizedError("Token introspection transport failed");
    }
    if (!response.ok) {
      throw new UnauthorizedError("Token introspection failed");
    }
    const body = (await response.json()) as { active?: boolean };
    return { active: body.active === true };
  }
}
