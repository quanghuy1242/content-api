# Media Upload Flow — Event-Driven With R2 + Queues

> Status: proposal, pending review
>
> Date: 2026-05-17
>
> Scope:
>
> - `src/domain/media/media.entity.ts`
> - `src/domain/media/media.repository.ts`
> - `src/application/media/create-media-upload.usecase.ts`
> - `src/infrastructure/storage/` (new)
> - `workers/media-processor/` (new)
> - `src/config/env.ts`
>
> Source docs:
>
> - `docs/architecture.md` §14 (Media Upload & Transformation Pipeline)
> - `.agent/skills/content-api-architecture/references/architecture-rules.md`
> - [Cloudflare R2 Event Notifications](https://developers.cloudflare.com/r2/buckets/event-notifications/)
> - [Cloudflare Image Resizing](https://developers.cloudflare.com/images/image-resizing/)

## Table Of Contents

- [1. Goal](#1-goal)
- [2. Current-State Findings](#2-current-state-findings)
- [3. Design Decisions](#3-design-decisions)
  - [3.1 Event-Driven: Why No `/complete` Endpoint](#31-event-driven-why-no-complete-endpoint)
  - [3.2 On-Demand Variants: Why No Pre-Generated Thumbnails](#32-on-demand-variants-why-no-pre-generated-thumbnails)
  - [3.3 Separate Worker: Why One Per Job Type](#33-separate-worker-why-one-per-job-type)
- [4. Upload Validation — Three-Layer Enforcement](#4-upload-validation--three-layer-enforcement)
- [5. Upload Flow (End To End)](#5-upload-flow-end-to-end)
- [6. Object Key Convention](#6-object-key-convention)
- [7. Media Status State Machine](#7-media-status-state-machine)
- [8. Variant Serving (On-Demand)](#8-variant-serving-on-demand)
- [9. Detailed Implementation Plan](#9-detailed-implementation-plan)
  - [9.1 Domain — Media Entity + Status Lifecycle](#91-domain--media-entity--status-lifecycle)
  - [9.2 Domain — ObjectStorage Interface](#92-domain--objectstorage-interface)
  - [9.3 Application — CreateMediaUploadUseCase](#93-application--createmediumuploadusecase)
  - [9.4 Infrastructure — R2Storage + Presigned URLs](#94-infrastructure--r2storage--presigned-urls)
  - [9.5 Infrastructure — D1 Enrichment (R2 Keys + Status Column)](#95-infrastructure--d1-enrichment-r2-keys--status-column)
  - [9.6 HTTP Layer — Routes + OpenAPI](#96-http-layer--routes--openapi)
  - [9.7 Variant Serving Route](#97-variant-serving-route)
  - [9.8 Worker — media-processor](#98-worker--media-processor)
  - [9.9 Wrangler Configuration](#99-wrangler-configuration)
- [10. Edge Cases And Failure Modes](#10-edge-cases-and-failure-modes)
- [11. Implementation Backlog](#11-implementation-backlog)
- [12. Future Backlog](#12-future-backlog)
- [13. Definition Of Done](#13-definition-of-done)

## 1. Goal

Add a real media upload flow to the content-api. Today `POST /media` only creates metadata rows (filename, alt, URLs) — no files are actually uploaded or stored. The target is a Cloudflare-native upload pipeline: presigned R2 URLs for direct-to-storage uploads, an event-driven completion flow via R2 + Cloudflare Queues, and on-demand image variant serving via `cf.image`.

## 2. Current-State Findings

### 2.1 Media is metadata-only

The `Media` entity explicitly states:

> Upload, image processing, and background derivative generation are explicitly outside this API.

`MediaStatus` has a single value: `"ready"`. There is no R2 binding in `env.ts`. `POST /media` accepts `{ alt, filename, url?, thumbnailURL?, ... }` — the client provides URLs. No files flow through the Worker.

### 2.2 Relevant files

| File | Current role |
|---|---|
| `src/domain/media/media.entity.ts` | `Media` entity, `MediaStatus = "ready"`, no lifecycle methods |
| `src/domain/media/media.repository.ts` | Standard CRUD interface |
| `src/application/media/create-media.usecase.ts` | Creates metadata + relationship |
| `src/http/routes/media.routes.ts` | `POST /media` → metadata only |
| `src/config/env.ts` | No R2 or Queue bindings |
| `src/infrastructure/db/schema.ts` | `media` table — no `original_key`, no status values besides `"ready"` |

## 3. Design Decisions

### 3.1 Event-Driven: Why No `/complete` Endpoint

After the client uploads to R2 via presigned URL, R2 fires an `object-create` event → Cloudflare Queue → a dedicated Worker marks the media as ready. No explicit `POST /media/:id/complete` endpoint.

- Single source of truth: the R2 event proves the file exists. No need for a client-triggered acknowledgment that can be called prematurely.
- Simpler client: the client uploads to R2, then polls `GET /media/:id` until status changes from `pending_upload` → `ready`.
- Idempotent by design: the queue consumer checks media status — if already `ready`, ack and skip.

### 3.2 On-Demand Variants: Why No Pre-Generated Thumbnails

Variant generation is CPU-heavy. Pre-generating thumb/md/lg/og/blur inside a Worker (even a queue consumer) requires Sharp/WASM which adds cold-start latency and memory pressure. Instead, serve variants on-demand via Cloudflare Image Resizing (`cf.image`):

```
GET /media/:id/variants/medium
  → load original from R2
  → return fetch(original, { cf: { image: { width: 960, format: 'webp' } } })
  → Cloudflare CDN caches the result
```

First request is slightly slower; every subsequent request hits cache. No storage cost for variants. No queue consumer for generation.

If pre-generated variants are needed later (e.g., strict latency budgets), they can be added as a future task behind the same `GET /media/:id/variants/:name` route — the client never knows the difference.

### 3.3 Separate Worker: Why One Per Job Type

The queue consumer runs as a **separate Worker** under `workers/media-processor/` in the same repository:

- **Independent deploy** — updating processor logic does not redeploy the API.
- **Independent scaling** — batches of upload events do not compete for CPU with API requests.
- **Leaner API Worker** — no queue bindings, no `queue()` export, no image processing imports.
- **Clean separation** — `src/` is the API domain; `workers/` is background jobs.

## 4. Upload Validation — Three-Layer Enforcement

A client could declare `image/png, 10KB` and then upload `video/mp4, 500MB` to the presigned URL. Three layers close this gap:

### Layer 1: Worker validates BEFORE signing (nice 400 errors)

```typescript
const ALLOWED_CONTENT_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
] as const;

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

if (!ALLOWED_CONTENT_TYPES.includes(input.contentType)) {
  throw new ValidationError("Unsupported file type");
}
if (input.size > MAX_FILE_SIZE_BYTES) {
  throw new ValidationError(`File exceeds maximum size of ${MAX_FILE_SIZE_BYTES} bytes`);
}
```

Client gets a clear rejection with a useful error message. Covers 90% of cases.

### Layer 2: R2 presigned URL policy conditions (enforced at PUT time)

The S3-compatible presigned URL includes a policy document with conditions. R2 enforces them at the upload layer — the PUT is rejected before any data is stored:

```
Conditions:
  ["content-length-range", 1, 10485760]
  ["starts-with", "$Content-Type", "image/"]
```

If the client's PUT request violates either condition, R2 returns 403. The Worker never sees the file, and no R2 event fires. This prevents a malicious client from uploading non-image content or oversized files even if they bypassed layer 1.

### Layer 3: Post-upload verification (media-processor Worker)

When the R2 event fires, the processor HEADs the object to get the actual uploaded size and content type. If these don't match the original declaration stored in the media row, the processor marks the media as `"failed"` instead of `"ready"`:

```typescript
const obj = await env.MEDIA_R2.head(key);         // actual size + type
if (obj.size > media.declaredSize) { markFailed(); return; }
if (!ALLOWED_CONTENT_TYPES.includes(obj.contentType)) { markFailed(); return; }
markReady();
```

This catches edge cases where R2 policy conditions aren't strict enough (e.g., `starts-with "image/"` matches `image/svg+xml` which could contain malicious scripts).

### Summary

| Layer | Where | What | Rejects |
|---|---|---|---|
| 1 | API Worker (pre-sign) | MIME allowlist + max size | Invalid declarations |
| 2 | R2 (PUT enforcement) | S3 policy conditions | Mismatched uploads |
| 3 | media-processor (post-upload) | HEAD verify actual vs declared | Policy gaps |

## 5. Upload Flow (End To End)

```
1. POST /media
   Client:  { filename: "hero.png", contentType: "image/png", size: 482331 }
   Worker:
      - authenticate, authorize
      - generate mediaId, object key: "media/{mediaId}/original"
      - generate presigned PUT URL (TTL: 5 minutes)
      - INSERT media row (status: pending_upload) + relationship (owner)
      - if idempotency key present: batch via BatchContext (see docs/001_)
   Response: { media: {...}, upload: { url, method: "PUT", expiresAt: "..." } }

2. Client PUTs directly to presigned URL
   R2: object stored at media/{mediaId}/original
   No Worker involvement.

3. R2 object-create event → media-processing Queue → media-processor Worker
   Worker:
      - extract mediaId from key: "media/{mediaId}/original"
      - skip if key does NOT end with "/original"
      - load media row from D1
      - if status !== "pending_upload" → ack, skip (idempotent)
      - update status → "ready"
      - ack

4. Client polls GET /media/:id
   Response: { status: "ready", ... }

5. Client renders:
   GET /media/:id/variants/thumb
   → Worker loads original from R2, applies cf.image, returns webp
   → CDN caches for subsequent requests
```

## 6. Object Key Convention

```
media/{mediaId}/original          ← trigger event (uploaded by client)
media/{mediaId}/variants/{name}   ← NOT stored physically (on-demand, cached at CDN)
```

The `media-processor` Worker only processes keys ending with `/original`. Variants are never physically stored, so there's no risk of re-triggering the queue. If pre-generated variants are added later, they would use a different prefix (e.g., `derivatives/`) or the consumer would filter by suffix.

## 7. Media Status State Machine

```
pending_upload ──▶ ready
     │
     └──▶ failed (R2 event never arrives within TTL — cleanup cron)
```

Minimal to start. If variant pre-generation is added later, insert `processing` between `pending_upload` and `ready`.

### Entity lifecycle methods

```typescript
class Media {
  // today: static create()
  // new:
  static beginUpload(props: { id, alt, filename, owner, contentType, filesize, originalKey }): Media
  markReady(): void      // called by media-processor Worker
  markFailed(): void     // called by cleanup cron

  publish(): void        // requires status === "ready"
  unpublish(): void
}
```

**Guard:** `publish()` throws if status !== `"ready"`. Can't make a non-existent image public.

## 8. Variant Serving (On-Demand)

Route: `GET /media/:id/variants/:name`

```typescript
// In the variant route handler
const media = await container.media.get.execute({ actor, mediaId: params.id });
if (media.visibility !== "public" && !actor) return 403;

const original = await env.MEDIA_R2.get(`media/${media.id}/original`);
if (!original) return 404;

const variants: Record<string, ImageTransformOptions> = {
  thumb:  { width: 160,  height: 160, fit: "cover",      format: "webp", quality: 75 },
  small:  { width: 480,  fit: "scale-down",              format: "webp", quality: 80 },
  medium: { width: 960,  fit: "scale-down",              format: "webp", quality: 82 },
  large:  { width: 1600, fit: "scale-down",              format: "webp", quality: 85 },
  og:     { width: 1200, height: 630, fit: "cover",      format: "jpg",  quality: 85 },
  blur:   { width: 24,   fit: "scale-down",              format: "webp", quality: 35 },
};

const cfg = variants[params.name];
if (!cfg) return 404;

return env.MEDIA_R2.get(`media/${media.id}/original`).then(original =>
  fetch(original, { cf: { image: cfg } })
);
// Cloudflare CDN caches this response automatically (immutable content).
```

## 9. Detailed Implementation Plan

### 9.1 Domain — Media Entity + Status Lifecycle

**File:** `src/domain/media/media.entity.ts`

Changes:
- `MediaStatus` expands: `"pending_upload"` | `"ready"` | `"failed"`
- Add `originalKey: string` to `MediaProps` (the R2 object key)
- Remove client-supplied `url` and `thumbnailURL` — these become derived server-side
- Add lifecycle methods: `static beginUpload()`, `markReady()`, `markFailed()`
- `publish()` guards: throws if status !== `"ready"`
- `variantUrl(name)` computed from id + version

### 9.2 Domain — ObjectStorage Interface

**File:** `src/domain/media/object-storage.ts` (new)

```typescript
export interface ObjectStorage {
  head(key: string): Promise<{ size: number; contentType: string } | null>;
  createPresignedPutUrl(key: string, contentType: string, ttlSeconds: number): Promise<string>;
}
```

Domain-layer interface — no R2 imports.

### 9.3 Application — CreateMediaUploadUseCase

**File:** `src/application/media/create-media-upload.usecase.ts` (new, replaces current `create-media.usecase.ts`)

Responsibilities:
- Validate input (filename, contentType, size against configured limits)
- Generate `mediaId`, object key
- Call `ObjectStorage.createPresignedPutUrl()`
- Create `Media` entity (status: `"pending_upload"`)
- Batch-insert media row + relationship (via `BatchContext`)
- Return media entity + presigned upload URL

### 9.4 Infrastructure — R2Storage + Presigned URLs

**File:** `src/infrastructure/storage/r2-storage.ts` (new)

```typescript
export class R2Storage implements ObjectStorage {
  constructor(private readonly bucket: R2Bucket, private readonly signer: R2PresignedUrlSigner) {}

  async head(key: string) {
    const obj = await this.bucket.head(key);
    return obj ? { size: obj.size, contentType: obj.httpMetadata?.contentType ?? "application/octet-stream" } : null;
  }

  async createPresignedPutUrl(key: string, contentType: string, ttlSeconds: number) {
    return this.signer.signPut(key, contentType, ttlSeconds);
  }
}
```

**File:** `src/infrastructure/storage/r2-presigned-url-signer.ts` (new)

Uses Cloudflare's S3-compatible API to generate presigned PUT URLs. Options:
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (heavier, more correct)
- Manual HMAC-SHA256 signing against R2's S3 endpoint (lighter, less dependency)

### 9.5 Infrastructure — D1 Enrichment (R2 Keys + Status Column)

**File:** `src/infrastructure/db/schema.ts`

Add columns to the `media` table:

```typescript
export const media = sqliteTable("media", {
  // ... existing columns ...
  originalKey: text("original_key"),              // "media/{id}/original"
  status: text("status").notNull().default("ready"), // ← already exists, just add new values
  uploadExpiresAt: integer("upload_expires_at", { mode: "timestamp_ms" }),
  // ... rest ...
});
```

`status` already exists. Add `"pending_upload"` | `"ready"` | `"failed"` as valid values. Adding `originalKey` ensures the queue consumer can verify the key matches the row. `uploadExpiresAt` enables cleanup of abandoned uploads.

### 9.6 HTTP Layer — Routes + OpenAPI

**File:** `src/http/routes/media.routes.ts`

- `POST /media` — now expects `{ filename, contentType, size }` (not URLs). Returns `{ media, upload: { url, method, expiresAt } }`.
- Keep existing `GET /media`, `GET /media/:id`, `PATCH /media/:id`, `POST /media/:id/publish`, `POST /media/:id/unpublish`, `DELETE /media/:id`.
- New: `GET /media/:id/variants/:name` — on-demand variant serving.

**File:** `src/http/schemas/media.schema.ts`

- `mediaCreateSchema` → `{ filename, contentType, size }` (remove url, thumbnailURL).
- `mediaResponseSchema` → add `originalKey`, `uploadExpiresAt` to response. `status` reflects state machine.

### 9.7 Variant Serving Route

**File:** `src/http/routes/media.routes.ts`

```typescript
const variantRoute = createRoute({
  method: "get",
  path: "/media/{id}/variants/{name}",
  request: { params: z.object({ id: idSchema, name: z.string() }) },
  responses: {
    200: { description: "Image variant" },
    404: { description: "Not found" },
  },
});

app.openapi(variantRoute, async (c) => {
  const { id, name } = c.req.valid("param");
  const media = await c.get("container").media.get.execute({ actor: c.get("actor"), mediaId: id });
  if (!media || media.status !== "ready") return c.json({ error: "Not found" }, 404);
  if (media.visibility !== "public") return c.json({ error: "Not found" }, 404);

  const variant = VARIANTS[name];
  if (!variant) return c.json({ error: "Unknown variant" }, 404);

  return env.MEDIA_R2.get(`media/${id}/original`).then(original => {
    if (!original) return c.json({ error: "Not found" }, 404);
    return fetch(original, { cf: { image: variant } });
  });
});
```

### 9.8 Worker — media-processor

**Location:** `workers/media-processor/` (new directory, same repo)

```
workers/media-processor/
  src/
    index.ts
    config.ts
  wrangler.jsonc
  tsconfig.json
```

**`workers/media-processor/src/index.ts`:**

```typescript
export default {
  async queue(batch: MessageBatch<R2Event>, env: Env, ctx: ExecutionContext) {
    const db = createDb(env.DB);

    for (const msg of batch.messages) {
      const { key } = msg.body.object;

      // Only process original uploads, not variant reads
      if (!key.endsWith("/original")) { msg.ack(); continue; }

      const mediaId = key.split("/")[1]; // "media/{mediaId}/original"
      const media = await loadMedia(db, mediaId);
      if (!media || media.status !== "pending_upload") { msg.ack(); continue; }

      await updateMediaStatus(db, mediaId, "ready");
      msg.ack();
    }
  },
};
```

No variant generation here — just validates and marks ready. The `cf.image` transform happens at serving time in the API Worker.

**`workers/media-processor/wrangler.jsonc`:**

```jsonc
{
  "name": "media-processor",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-01",
  "d1_databases": [
    { "binding": "DB", "database_name": "content-api-db", "database_id": "<DB_ID>" }
  ],
  "queues": {
    "consumers": [
      { "queue": "media-processing", "max_batch_size": 5, "max_batch_timeout": 10 }
    ]
  }
}
```

Note: no `r2_buckets` binding — the processor doesn't touch R2. It only reads/writes D1.

### 9.9 Wrangler Configuration

**API Worker (`wrangler.jsonc`)** — stays the same except:

```jsonc
{
  "r2_buckets": [
    { "binding": "MEDIA_R2", "bucket_name": "content-api-media" }
  ]
}
```

No queue binding on the API Worker (it doesn't produce or consume — the R2 bucket itself pushes events to the queue).

**R2 Event Notification (one-time setup):**

```sh
npx wrangler r2 bucket notification create content-api-media \
  --event-type object-create \
  --queue media-processing \
  --prefix "media/"
```

**Queue creation (one-time setup):**

```sh
npx wrangler queues create media-processing
```

## 10. Edge Cases And Failure Modes

| Scenario | Behavior |
|---|---|
| Client never uploads to presigned URL | Media stays `pending_upload`. Cleanup cron deletes rows where `uploadExpiresAt < now()` and status is `pending_upload`. |
| R2 event never fires (rare, but possible) | Same as above — cleanup cron eventually marks as `failed`. |
| R2 event fires twice (retry) | Queue consumer checks status — if not `pending_upload`, ack and skip. Idempotent. |
| Variant name not recognized | `GET /media/:id/variants/badname` → 404. |
| `publish()` called on `pending_upload` media | Domain entity throws — `status` must be `"ready"`. |
| `cf.image` not available (plan limits) | Variant route returns the raw original via R2 without transform. Graceful degradation. |
| Concurrent uploads to same presigned URL | R2 PUT is idempotent (last write wins). Object exists regardless. |
| Large file upload > R2 limit | R2 supports up to 5 TB per object. Presigned URL TTL of 5 min is the practical constraint — client must complete upload within that window. |
| Client declares `image/png, 10KB`, uploads `video/mp4, 500MB` | Layer 1 rejects if content type not in allowlist. Layer 2 (R2 policy: `starts-with "$Content-Type" "image/"` + `content-length-range`) rejects at PUT time. Layer 3 (media-processor HEAD) verifies actual metadata; marks `failed` if mismatched. |
| Client declares `image/png, 5MB`, uploads `image/png, 15MB` | Layer 1 allows (content type OK, declared size OK). Layer 2 rejects (content-length-range 1–10485760). No bytes stored. Client gets 403 from R2. |
| Client uploads `image/svg+xml` | `starts-with "image/"` would allow it. Layer 3 HEAD reveals `image/svg+xml` which is NOT in `ALLOWED_CONTENT_TYPES` → marked `failed`. SVG can carry XSS; this is intentionally excluded. |

## 11. Implementation Backlog

### R1. Domain Layer

- [ ] Expand `MediaStatus`: `"pending_upload"` | `"ready"` | `"failed"`
- [ ] Add `originalKey`, `uploadExpiresAt` to `MediaProps`
- [ ] Replace `static create()` with `static beginUpload()`
- [ ] Add `markReady()`, `markFailed()` lifecycle methods
- [ ] Add `publish()` guard: throws if status !== `"ready"`
- [ ] Add `ObjectStorage` interface in `src/domain/media/object-storage.ts`
- [ ] Update `MediaRepository` interface if `create()` signature changes

### R2. Infrastructure

- [ ] Add `originalKey`, `uploadExpiresAt` columns to `media` schema; add new status values
- [ ] Implement `R2Storage` + `R2PresignedUrlSigner` in `src/infrastructure/storage/`
- [ ] Update `DrizzleMediaRepository`, media mappers for new columns
- [ ] Wire `MEDIA_R2` binding into `env.ts`

### R3. Application

- [ ] Replace `CreateMediaUseCase` with `CreateMediaUploadUseCase`
- [ ] Accept `ObjectStorage`, `IdempotencyRepository` (from 001_ doc), `BatchContext`
- [ ] Validate content type against `ALLOWED_CONTENT_TYPES`, size against `MAX_FILE_SIZE_BYTES`
- [ ] Generate presigned URL with policy conditions (`content-length-range`, `starts-with $Content-Type`)
- [ ] Batch-insert media row + relationship

### R4. HTTP Layer

- [ ] Update `POST /media` schema: `{ filename, contentType, size }`
- [ ] Update response schema: include `upload` object
- [ ] Add `GET /media/:id/variants/:name` route with `cf.image` transform
- [ ] Update `presentMedia` for new fields

### R5. media-processor Worker

- [ ] Create `workers/media-processor/` with `wrangler.jsonc`, `tsconfig.json`
- [ ] Implement `queue()` handler: extract mediaId from key, load media row, skip if not `pending_upload`
- [ ] Post-upload verification: HEAD R2 object, verify actual size ≤ declared size, actual contentType in `ALLOWED_CONTENT_TYPES`; mark `failed` if mismatch
- [ ] On success: update status to `"ready"`
- [ ] Share Drizzle schema from parent repo (or duplicate minimal schema)
- [ ] Deploy and test end-to-end

### R6. Infrastructure Setup

- [ ] Create R2 bucket: `npx wrangler r2 bucket create content-api-media`
- [ ] Create Queue: `npx wrangler queues create media-processing`
- [ ] Configure R2 → Queue notification: `npx wrangler r2 bucket notification create ...`
- [ ] Add `MEDIA_R2` binding to API Worker `wrangler.jsonc`

### R7. Architecture Skill Update

Scope: `.agent/skills/content-api-architecture/references/architecture-rules.md`

- [ ] Add `workers/` directory explanation: background job Workers, one per job type, independent deploy
- [ ] Add `src/infrastructure/storage/` to infrastructure layer: R2 storage implementations
- [ ] Add `ObjectStorage` to domain interfaces list
- [ ] Add Media upload flow to layer rules (domain lifecycle, application use case, infrastructure signing)

### R8. Integration Tests

- [ ] `POST /media` returns `upload.url` with presigned PUT URL
- [ ] `GET /media/:id` returns `status: "pending_upload"` after creation
- [ ] Simulate R2 event → media-processor → `GET /media/:id` returns `status: "ready"`
- [ ] `POST /media/:id/publish` succeeds only when `status === "ready"`
- [ ] `GET /media/:id/variants/thumb` returns image with `cf.image` transform

## 12. Future Backlog

- Pre-generated variants via Sharp/WASM in the queue consumer (replace on-demand if needed)
- `failed` cleanup cron: move abandoned `pending_upload` rows to `failed`, delete orphaned R2 objects
- `POST /media/:id/complete` as optional fast-path alongside the R2 event
- Media versioning: increment `version` on re-upload, invalidate CDN cache

## 13. Definition Of Done

- [ ] `POST /media` accepts `{ filename, contentType, size }` and returns a presigned R2 PUT URL
- [ ] Presigned URL enforces content type and size limits via S3 policy conditions
- [ ] `POST /media` rejects unsupported content types and oversized files with 400
- [ ] Media entity supports `pending_upload` → `ready` lifecycle
- [ ] `MediaStatus` state machine guards: `publish()` requires `"ready"`, `markReady()` requires `"pending_upload"`
- [ ] `media-processor` Worker processes R2 events, verifies actual vs declared file metadata, and marks media as `"ready"`
- [ ] `media-processor` marks media as `"failed"` when actual content type or size violates limits
- [ ] `GET /media/:id/variants/:name` serves on-demand image variants via `cf.image`
- [ ] End-to-end test: upload → event → ready → render variant
- [ ] Idempotency key support on `POST /media` (per 001_ doc)
- [ ] No queue bindings in API Worker; no variant generation in API Worker
- [ ] `corepack pnpm typecheck` passes in both `src/` and `workers/media-processor/`
