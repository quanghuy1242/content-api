import {
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_CONFLICT,
  HTTP_STATUS_FORBIDDEN,
  HTTP_STATUS_INTERNAL_ERROR,
  HTTP_STATUS_NOT_FOUND,
  HTTP_STATUS_UNAUTHORIZED,
} from "@/shared/constants";

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
    super("VALIDATION_ERROR", message, HTTP_STATUS_BAD_REQUEST, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super("UNAUTHORIZED", message, HTTP_STATUS_UNAUTHORIZED);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super("FORBIDDEN", message, HTTP_STATUS_FORBIDDEN);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super("NOT_FOUND", message, HTTP_STATUS_NOT_FOUND);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("CONFLICT", message, HTTP_STATUS_CONFLICT, details);
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
    status: HTTP_STATUS_INTERNAL_ERROR,
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
