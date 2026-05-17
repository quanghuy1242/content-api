import type { Context, Next } from "hono";

/**
 * Opportunistically authenticates requests so public routes can still make
 * actor-aware decisions. Protected actions call `requireActor` in their route
 * handler and then delegate resource authorization to use cases/policies.
 */
export async function optionalAuthMiddleware(c: Context, next: Next) {
  const authUseCase = c.get("container").auth;
  const header = c.req.header("authorization") ?? null;

  if (header) {
    c.set("actor", await authUseCase.execute(header));
  } else {
    c.set("actor", null);
  }

  await next();
}
