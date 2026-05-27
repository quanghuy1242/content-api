import { UnauthorizedError } from "@/shared/errors";

type TokenResponse = {
  readonly access_token?: unknown;
  readonly expires_in?: unknown;
};

type CachedToken = {
  readonly accessToken: string;
  readonly expiresAt: number;
};

const memoryTokens = new Map<string, CachedToken>();

export function clearClientCredentialsTokenMemoryCache(): void {
  memoryTokens.clear();
}

export type ClientCredentialsTokenProviderConfig = {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly audience: string;
  readonly scope: string;
  readonly cache?: KVNamespace;
  readonly fetchImpl?: typeof fetch;
};

/**
 * Infrastructure OAuth client for low-volume service-to-service calls to `id`.
 *
 * It fetches a short-lived client-credentials token, refreshes before expiry,
 * and optionally stores the token in KV so warm Worker isolates do not each hit
 * the token endpoint for every policy write.
 */
export class ClientCredentialsTokenProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ClientCredentialsTokenProviderConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async getAccessToken(): Promise<string> {
    const cached = await this.readCachedToken();
    if (cached) return cached.accessToken;

    const fresh = await this.fetchToken();
    await this.writeCachedToken(fresh);
    return fresh.accessToken;
  }

  private async readCachedToken(): Promise<CachedToken | null> {
    const memory = memoryTokens.get(this.cacheKey());
    if (memory && tokenStillUsable(memory)) return memory;

    const cached = await this.config.cache?.get(this.cacheKey());
    if (!cached) return null;

    try {
      const parsed = JSON.parse(cached) as CachedToken;
      if (tokenStillUsable(parsed)) {
        memoryTokens.set(this.cacheKey(), parsed);
        return parsed;
      }
    } catch {
      return null;
    }

    return null;
  }

  private async writeCachedToken(token: CachedToken): Promise<void> {
    memoryTokens.set(this.cacheKey(), token);
    const ttlSeconds = Math.max(Math.floor((token.expiresAt - Date.now()) / 1000), 1);
    await this.config.cache?.put(this.cacheKey(), JSON.stringify(token), { expirationTtl: ttlSeconds });
  }

  private async fetchToken(): Promise<CachedToken> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      resource: this.config.audience,
      scope: this.config.scope,
    });

    const response = await this.fetchImpl(this.config.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      throw new UnauthorizedError("M2M token request failed");
    }

    const payload = await response.json() as TokenResponse;
    if (typeof payload.access_token !== "string" || !payload.access_token) {
      throw new UnauthorizedError("M2M token response was invalid");
    }

    const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? payload.expires_in
      : 300;

    return {
      accessToken: payload.access_token,
      expiresAt: Date.now() + Math.max(expiresIn - 60, 1) * 1000,
    };
  }

  private cacheKey() {
    return [
      "content-api",
      "scim-directory-token",
      this.config.clientId,
      this.config.audience,
      this.config.scope,
    ].join(":");
  }
}

function tokenStillUsable(token: CachedToken): boolean {
  return typeof token.accessToken === "string" && token.accessToken.length > 0 && token.expiresAt > Date.now();
}
