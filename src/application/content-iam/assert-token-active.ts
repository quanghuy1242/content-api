import type { IntrospectPresentedToken } from "@/domain/auth/introspection-port";
import { UnauthorizedError } from "@/shared/errors";

/**
 * Gate B — asserts the presented bearer token is still active via
 * RFC 7662 introspection. Called at the start of every authority-changing
 * Content IAM use case before any policy authorization or mutation.
 */
export async function assertTokenActive(
  introspection: IntrospectPresentedToken,
  token: string,
): Promise<void> {
  const result = await introspection.introspect(token);
  if (!result.active) {
    throw new UnauthorizedError("Token introspection denied the request");
  }
}
