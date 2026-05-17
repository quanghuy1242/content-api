export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

/**
 * Application-level error base used at layer boundaries.
 *
 * Use cases and policies throw these errors to express API-relevant failure
 * semantics without depending on Hono response objects.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("VALIDATION_ERROR", message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super("FORBIDDEN", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super("NOT_FOUND", message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("CONFLICT", message, 409, details);
  }
}

/**
 * Internal cross-layer signal for a concurrent idempotency reservation race.
 *
 * Infrastructure raises this after translating the storage-specific unique
 * constraint failure. Application use cases catch it to re-read the active
 * idempotency row and replay the cached response. It is intentionally not an
 * `AppError` because clients should only see the final replay or a normal
 * application conflict, never this reservation detail.
 */
export class IdempotencyReservationConflictError extends Error {
  constructor() {
    super("Idempotency reservation already exists");
  }
}

/**
 * Converts unknown failures into the single documented JSON error envelope.
 * This is intentionally shared by middleware only; route handlers should throw
 * typed errors and let the global error boundary shape the response.
 */
export function toErrorResponse(error: unknown, requestId: string) {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          details: error.details,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        requestId,
        details: {},
      },
    },
  };
}
