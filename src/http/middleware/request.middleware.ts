import type { Context, Next } from "hono";

export async function requestContextMiddleware(c: Context, next: Next) {
  c.set("requestId", crypto.randomUUID());
  await next();
}
