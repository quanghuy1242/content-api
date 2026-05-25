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
export const MAX_AUDIT_REASON_LENGTH = 1000;
export const SLUG_BASE_MAX_LENGTH = 111;
export const SLUG_SUFFIX_LENGTH = 8;

/** Idempotency configuration. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const MILLISECONDS_PER_SECOND = 1000;

/** Bounded storage policy for denied Content IAM security mutation audit events. */
export const DENIED_POLICY_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const DENIED_POLICY_EVENT_RATE_WINDOW_MS = 60 * 1000;
export const DENIED_POLICY_EVENT_RATE_LIMIT = 5;

/** Idempotency route identifiers scoped per resource. */
export const CATEGORIES_CREATE_ROUTE = "POST /categories" as const;
export const POSTS_CREATE_ROUTE = "POST /posts" as const;
export const MEDIA_CREATE_ROUTE = "POST /media" as const;
export const USERS_CREATE_ROUTE = "POST /users" as const;
export const BOOKS_CREATE_ROUTE = "POST /books" as const;
export const BOOK_POLICY_BINDINGS_CREATE_ROUTE = "POST /books/{bookId}/policy-bindings" as const;
export const BOOK_POLICY_DENIALS_CREATE_ROUTE = "POST /books/{bookId}/policy-denials" as const;
export const BOOK_OWNERSHIP_TRANSFER_ROUTE = "POST /books/{bookId}/ownership-transfer" as const;
export const ORG_POLICY_BINDINGS_CREATE_ROUTE = "POST /organizations/{orgId}/policy-bindings" as const;
export const ORG_POLICY_DENIALS_CREATE_ROUTE = "POST /organizations/{orgId}/policy-denials" as const;
export const ORG_CONTENT_ROLE_CREATE_ROUTE = "POST /organizations/{orgId}/content-roles" as const;
export const ORG_CONTENT_ROLE_PERMISSIONS_REPLACE_ROUTE =
  "PUT /organizations/{orgId}/content-roles/{roleId}/permissions" as const;
export const ORG_CONTENT_ADMIN_BOOTSTRAP_ROUTE = "POST /organizations/{orgId}/content-iam/bootstrap" as const;
export const ORG_CONTENT_ADMIN_DELEGATE_ROUTE = "POST /organizations/{orgId}/content-admins" as const;

/**
 * Shared media upload and derivative constants. Routes, use cases, workers, and
 * tests should all import these values rather than redefining upload limits,
 * MIME allowlists, object-key fragments, or variant dimensions.
 */
export const MEDIA_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Default upload validation limits for upload-backed media. */
export const MEDIA_UPLOAD_LIMITS = {
  defaultMaxImageUploadBytes: 10 * 1024 * 1024,
  defaultUploadUrlTtlSeconds: 300,
} as const;

/** Fixed transform settings for the generated blur-up placeholder. */
export const MEDIA_LOW_RES_PLACEHOLDER = {
  width: 24,
  height: 24,
  quality: 50,
  blur: 2,
  format: "webp" as const,
} as const;

/** Fixed R1 derivative variants generated during queue processing. */
export const MEDIA_VARIANTS = {
  thumb: { width: 160, height: 160, fit: "cover" as const, format: "webp" as const, quality: 82 },
  small: { width: 480, fit: "contain" as const, format: "webp" as const, quality: 82 },
  medium: { width: 960, fit: "contain" as const, format: "webp" as const, quality: 84 },
  large: { width: 1600, fit: "contain" as const, format: "webp" as const, quality: 86 },
  og: { width: 1200, height: 630, fit: "cover" as const, format: "jpeg" as const, quality: 86 },
  blur: { width: 64, height: 64, fit: "cover" as const, format: "webp" as const, quality: 42, blur: 8 },
} as const;

/** Stable variant names accepted by the API variant route. */
export const MEDIA_VARIANT_NAMES = ["thumb", "small", "medium", "large", "og", "blur"] as const satisfies readonly (keyof typeof MEDIA_VARIANTS)[];

export type MediaVariantName = (typeof MEDIA_VARIANT_NAMES)[number];

/** Prefix used for all media object keys in the private R2 bucket. */
export const MEDIA_OBJECT_PREFIX = "media";

/** Number of non-variant stream branches used during queue processing. */
export const MEDIA_DERIVATIVE_STREAM_OVERHEAD = 2;

/** Offset from the cloned stream list where per-variant streams begin. */
export const MEDIA_VARIANT_STREAM_OFFSET = 2;

export function normalizeMediaContentType(value: string) {
  return value === "image/jpg" ? "image/jpeg" : value;
}

export function mediaOriginalKey(mediaId: string, version: number) {
  return `${MEDIA_OBJECT_PREFIX}/${mediaId}/v${version}/original`;
}

export function mediaVariantKey(mediaId: string, version: number, name: MediaVariantName) {
  const variant = MEDIA_VARIANTS[name];
  return `${MEDIA_OBJECT_PREFIX}/${mediaId}/v${version}/variants/${name}.${variant.format}`;
}

/** Media statuses that the queue processor considers terminal (duplicate events are skipped). */
export const MEDIA_TERMINAL_STATUSES = new Set(["ready", "failed", "expired"]);

/** Maximum number of scheduled entities the cron driver processes per manager per run. */
export const SCHEDULED_PUBLISH_BATCH_LIMIT = 500;
