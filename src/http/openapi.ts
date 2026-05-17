import { z } from "@hono/zod-openapi";

/**
 * Standard JSON error envelope returned by the global error middleware.
 * Route definitions reuse this so OpenAPI documents the real failure shape.
 */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.string(), z.unknown()),
  }),
});

/**
 * Cursor pagination metadata shared by all list endpoints.
 */
export const pageResponseSchema = z.object({
  nextCursor: z.string().optional(),
});

export const healthResponseSchema = z.object({
  ok: z.boolean(),
});

/**
 * Wrap a resource response in the API's `{ data }` envelope.
 */
export function dataResponseSchema<T extends z.ZodTypeAny>(schema: T) {
  return z.object({ data: schema });
}

/**
 * Wrap a paginated collection response in the API's `{ data, page }` envelope.
 */
export function listResponseSchema<T extends z.ZodTypeAny>(schema: T) {
  return z.object({
    data: z.array(schema),
    page: pageResponseSchema,
  });
}

/**
 * OpenAPI helper for JSON response objects.
 */
export function jsonContent<T extends z.ZodTypeAny>(schema: T, description: string) {
  return {
    content: {
      "application/json": {
        schema,
      },
    },
    description,
  };
}

/**
 * OpenAPI helper for required JSON request bodies.
 */
export function jsonRequestBody<T extends z.ZodTypeAny>(schema: T, description: string) {
  return {
    content: {
      "application/json": {
        schema,
      },
    },
    description,
    required: true,
  };
}

/**
 * Error responses common to authenticated JSON API routes.
 */
export const commonErrorResponses = {
  400: jsonContent(errorResponseSchema, "Validation error"),
  401: jsonContent(errorResponseSchema, "Authentication required or token invalid"),
  403: jsonContent(errorResponseSchema, "Actor is not allowed to perform this action"),
  404: jsonContent(errorResponseSchema, "Resource not found"),
  409: jsonContent(errorResponseSchema, "Resource conflict"),
  500: jsonContent(errorResponseSchema, "Internal server error"),
};

export const bearerSecurity = [{ Bearer: [] }];

