export type IntrospectionResult = {
  readonly active: boolean;
};

/**
 * Port for OAuth 2.0 Token Introspection (RFC 7662).
 *
 * Called by authority-changing use cases to verify the presented token is
 * still active before committing IAM mutations. Transport failure must deny.
 */
export interface IntrospectPresentedToken {
  introspect(token: string): Promise<IntrospectionResult>;
}
