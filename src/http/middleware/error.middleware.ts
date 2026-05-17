import type { Context } from "hono";
import { ZodError } from "zod";
import { toErrorResponse, ValidationError } from "@/shared/errors";

/**
 * Last-resort HTTP error boundary. It preserves documented application errors,
 * normalizes Zod validation failures, and hides unknown exceptions behind the
 * standard `INTERNAL_ERROR` envelope.
 */
export function handleAppError(error: unknown, c: Context) {
  const requestId = c.get("requestId");
  const normalized =
    error instanceof ZodError ? new ValidationError("Validation failed", { issues: error.issues }) : error;
  const response = toErrorResponse(normalized, requestId);
  return c.json(response.body, response.status as never);
}
