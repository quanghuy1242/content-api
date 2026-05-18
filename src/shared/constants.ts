/** HTTP status codes used across layers. */
export const HTTP_STATUS_OK = 200;
export const HTTP_STATUS_CREATED = 201;
export const HTTP_STATUS_NO_CONTENT = 204;
export const HTTP_STATUS_BAD_REQUEST = 400;
export const HTTP_STATUS_UNAUTHORIZED = 401;
export const HTTP_STATUS_FORBIDDEN = 403;
export const HTTP_STATUS_NOT_FOUND = 404;
export const HTTP_STATUS_CONFLICT = 409;
export const HTTP_STATUS_INTERNAL_ERROR = 500;

/** Cursor-based pagination defaults. */
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** Validation field length limits. */
export const MAX_NAME_LENGTH = 255;
export const MAX_SLUG_LENGTH = 120;
export const SLUG_BASE_MAX_LENGTH = 111;
export const SLUG_SUFFIX_LENGTH = 8;

/** Idempotency configuration. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Idempotency route identifiers scoped per resource. */
export const CATEGORIES_CREATE_ROUTE = "POST /categories" as const;
export const POSTS_CREATE_ROUTE = "POST /posts" as const;
export const MEDIA_CREATE_ROUTE = "POST /media" as const;
export const USERS_CREATE_ROUTE = "POST /users" as const;
