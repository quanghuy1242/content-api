# Media Upload Flow - Event-Driven R2 Uploads And Processor-Generated Variants

> Status: revised proposal, pending architecture approval
>
> Date: 2026-05-18
>
> Scope:
>
> - `docs/002_media-upload-flow.md`
> - Future implementation under `src/domain/media/**`
> - Future implementation under `src/application/media/**`
> - Future implementation under `src/http/routes/media.routes.ts`
> - Future implementation under `src/http/schemas/media.schema.ts`
> - Future implementation under `src/http/presenters/media.presenter.ts`
> - Future implementation under `src/infrastructure/db/schema.ts`
> - Future implementation under `src/infrastructure/repositories/**media**`
> - Future implementation under `src/infrastructure/storage/**`
> - Future implementation under `src/composition/create-request-container.ts`
> - Future implementation under `workers/media-processor/**`
> - Future configuration in `src/config/env.ts`, `wrangler.jsonc`, and worker-specific Wrangler config
>
> Source docs:
>
> - `docs/architecture.md` section 14, "Media Upload & Transformation Pipeline"
> - `docs/architecture.md` section 15, "Media Public/Private Visibility"
> - `docs/architecture.md` section 17, "Idempotency"
> - `docs/architecture.md` section 18, "Transaction & Partial-Write Policy"
> - `docs/payloadcms-schema-spec.md` section 2, "`media`"
> - `.agents/skills/content-api-architecture/SKILL.md`
> - Cloudflare R2 presigned URLs: <https://developers.cloudflare.com/r2/api/s3/presigned-urls/>
> - Cloudflare R2 event notifications: <https://developers.cloudflare.com/r2/buckets/event-notifications/>
> - Cloudflare R2 public buckets: <https://developers.cloudflare.com/r2/buckets/public-buckets/>
> - Cloudflare Images Workers binding: <https://developers.cloudflare.com/images/optimization/transformations/bindings/>
> - Cloudflare Image Resizing via Workers: <https://developers.cloudflare.com/images/optimization/transformations/transform-via-workers/>
> - Cloudflare Workers Vitest integration: <https://developers.cloudflare.com/workers/testing/vitest-integration/>
>
> Assumptions:
>
> - This document is planning only. No implementation has been started.
> - R1 optimizes for a reliable direct-to-R2 upload flow and processor-generated derivative files.
> - R1 accepts that upload byte-size limits are enforced before signing and after upload verification, not by an R2 `content-length-range` policy.
> - R1 uses a private R2 bucket. Public and private variant delivery goes through the API Worker, not direct public R2 URLs.
> - The project is still in coding phase with no production data; migrations can be direct and do not need compatibility bridges for existing rows.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. Summary Of Revisions](#2-summary-of-revisions)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 Implemented Media Model](#31-implemented-media-model)
  - [3.2 Implemented API And Persistence](#32-implemented-api-and-persistence)
  - [3.3 Existing Architecture Direction](#33-existing-architecture-direction)
  - [3.4 Cloudflare Constraints Verified](#34-cloudflare-constraints-verified)
- [4. Target Model](#4-target-model)
  - [4.1 First-Release Flow](#41-first-release-flow)
  - [4.2 Non-Goals For R1](#42-non-goals-for-r1)
  - [4.3 Earlier Options Superseded By This Plan](#43-earlier-options-superseded-by-this-plan)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Event-Driven Completion In R1](#51-event-driven-completion-in-r1)
  - [5.2 Presigned PUT, Not Presigned POST](#52-presigned-put-not-presigned-post)
  - [5.3 Processor-Generated Variants Through Images Binding](#53-processor-generated-variants-through-images-binding)
  - [5.4 Separate Queue Consumer Worker](#54-separate-queue-consumer-worker)
  - [5.5 Store Upload Facts Separately From Served URLs](#55-store-upload-facts-separately-from-served-urls)
  - [5.6 Central Media Constants](#56-central-media-constants)
  - [5.7 API Variant Proxy, Streaming, And Cache](#57-api-variant-proxy-streaming-and-cache)
- [6. API Contract](#6-api-contract)
  - [6.1 Create Upload](#61-create-upload)
  - [6.2 Get Media](#62-get-media)
  - [6.3 Publish And Unpublish](#63-publish-and-unpublish)
  - [6.4 Serve Variant](#64-serve-variant)
- [7. Data Model](#7-data-model)
  - [7.1 Media Entity Fields](#71-media-entity-fields)
  - [7.2 Media Status State Machine](#72-media-status-state-machine)
  - [7.3 Object Key Convention](#73-object-key-convention)
- [8. Validation And Security Model](#8-validation-and-security-model)
  - [8.1 Pre-Sign Validation](#81-pre-sign-validation)
  - [8.2 Signed Upload Requirements](#82-signed-upload-requirements)
  - [8.3 Post-Upload Verification](#83-post-upload-verification)
  - [8.4 Public Read Rules](#84-public-read-rules)
- [9. Implementation Plan](#9-implementation-plan)
  - [9.1 Domain Layer](#91-domain-layer)
  - [9.2 Application Layer](#92-application-layer)
  - [9.3 Infrastructure Persistence](#93-infrastructure-persistence)
  - [9.4 Infrastructure Storage](#94-infrastructure-storage)
  - [9.5 HTTP Layer](#95-http-layer)
  - [9.6 Composition And Config](#96-composition-and-config)
  - [9.7 Media Processor Worker](#97-media-processor-worker)
  - [9.8 Wrangler And Cloudflare Setup](#98-wrangler-and-cloudflare-setup)
  - [9.9 Documentation Updates](#99-documentation-updates)
- [10. Test And Verification Plan](#10-test-and-verification-plan)
- [11. Edge Cases And Failure Modes](#11-edge-cases-and-failure-modes)
- [12. Implementation Backlog](#12-implementation-backlog)
- [13. Future Backlog](#13-future-backlog)
- [14. Definition Of Done](#14-definition-of-done)
- [15. Final Model](#15-final-model)

## 1. Goal

Add a real media upload flow to `content-api`. The current API creates media metadata rows only; clients can provide URL-like fields, but binary data never reaches R2 through a controlled server flow.

R1 should provide:

- Authenticated `POST /media` that creates a `pending_upload` media row and returns a short-lived R2 presigned PUT URL.
- Direct browser/mobile upload to a generated R2 object key.
- R2 `object-create` event notification to a Cloudflare Queue.
- A dedicated `workers/media-processor` consumer that verifies the object and marks media `ready` or `failed`.
- Read and publish behavior that never exposes pending, failed, or private media publicly.
- Processor-generated image variants stored in private R2 and streamed through the API.
- One generated low-resolution placeholder stored on the media row for fast UI blur-up rendering.

## 2. Summary Of Revisions

This revision fixes several missing or incorrect pieces from the earlier proposal:

- Remove the claim that R2 presigned PUT URLs support POST-style policy conditions such as `content-length-range`. Cloudflare documents PUT presigned URLs and notes that presigned POST form uploads are not currently supported. PUT signing can restrict signed headers such as `Content-Type`, but not an S3 POST policy document.
- Replace request-time variant transformation with processor-time generation. The media processor uses the Cloudflare Images binding once per fixed variant, stores variant objects in private R2, and the API streams stored variants.
- Give the `media-processor` Worker an R2 binding. R2 event messages include object key, size, and ETag, but not content type. The processor must `head()` the object or inspect it through a storage interface before marking media ready.
- Add explicit `expired` status for abandoned uploads. This avoids overloading `failed`, which should mean upload or processing validation failed.
- Remove compatibility requirements for old metadata-only media rows because there is no production data yet.
- Add missing test expectations for idempotency, status transitions, access control, variant caching behavior, configuration validation, and queue retry behavior.
- Keep the proposal explicit about where it intentionally narrows `docs/architecture.md`.
- Resolve the bucket access model: R1 keeps R2 private and uses the API Worker as the authenticated/cached media surface.

## 3. Current-State Findings

### 3.1 Implemented Media Model

Observed files:

| File | Current behavior |
|---|---|
| `src/domain/media/media.entity.ts` | `MediaStatus` is only `"ready"`. `Media.create()` creates private ready metadata and explicitly documents upload/processing as outside the API. |
| `src/domain/media/media.repository.ts` | Standard CRUD interface: list, find, create, update, delete. |
| `src/domain/media/media.policy.ts` | Public reads require `visibility === "public"` and `status === "ready"`. Private reads and mutations require admin or owner relationship. |
| `src/domain/media/media-create.workflow.ts` | Existing idempotent create workflow batches media row, owner relationship, and idempotency row. |

The entity currently allows `publish()` with no status guard because every media row is already `ready`. Upload status must become a domain invariant before uploads are added.

### 3.2 Implemented API And Persistence

Observed files:

| File | Current behavior |
|---|---|
| `src/http/schemas/media.schema.ts` | `POST /media` accepts `alt`, `filename`, client-supplied `url`, `thumbnailURL`, `mimeType`, `filesize`, dimensions, and focal point fields. |
| `src/http/routes/media.routes.ts` | Routes are thin and call one use case per handler. No upload URL, variant, refresh, or complete endpoints exist. |
| `src/http/presenters/media.presenter.ts` | Returns the full media snapshot with ISO dates. Comment says binary upload state is intentionally absent. |
| `src/application/media/create-media.usecase.ts` | Creates a ready metadata entity and owner relationship; supports idempotency. |
| `src/infrastructure/db/schema.ts` | `media` table has `url`, `thumbnail_url`, `mime_type`, `filesize`, dimensions, status default `"ready"`, and visibility default `"private"`. No R2 key, upload expiry, version, failure reason, or content digest fields. |
| `src/config/env.ts` | Validates auth strings only. No R2, Images, Queue, upload TTL, max bytes, or signer credential config. |
| `wrangler.jsonc` | D1 binding only. No R2 bucket or Images binding. |
| `tests/api.test.ts` | Single API test file seeds metadata-only ready media rows directly in D1. |

The current implementation already has the right clean-architecture shape. The upload feature should extend that shape rather than moving storage logic into routes.

### 3.3 Existing Architecture Direction

`docs/architecture.md` section 14 has been aligned with this proposal:

- `POST /media` creates pending media and a presigned upload URL.
- R2 `object-create` events drive completion through `workers/media-processor`.
- The processor verifies the original, generates `lowResUrl`, generates fixed variants, writes variants to private R2, and marks media ready.
- Variants are served through versioned URLs: `GET /media/:id/v/:version/variants/:name`.
- The R2 bucket stays private; the API Worker streams generated variant objects and only uses Images binding in the processor.

Older architecture notes referred to `/complete` and pre-generated R2 variants. Those have been superseded by this R1 plan.

### 3.4 Cloudflare Constraints Verified

Relevant Cloudflare facts:

- R2 presigned URLs authorize a single S3 operation on a single object and support `GET`, `HEAD`, `PUT`, and `DELETE`. Cloudflare documents that presigned `POST` form uploads are not currently supported.
- For presigned PUT uploads, Cloudflare recommends specifying `ContentType`; the signature includes that header, so a client that sends a different `Content-Type` receives a signature error.
- R2 event notifications send messages to Queues for bucket changes. The event supports prefix and suffix filtering. `object-create` is triggered by `PutObject`, `CopyObject`, and `CompleteMultipartUpload`.
- R2 event messages include `object.key`, `object.size`, and `object.eTag`, but do not include content type.
- Cloudflare Images via `fetch(..., { cf: { image } })` requires a fetchable source image URL. For private R2 originals, the Images binding is the better fit because it can transform a `ReadableStream` from R2 without exposing the original through a public URL.
- Responses from the Images binding are not automatically cached; the Worker should add explicit cache behavior through headers and/or Cache API if R1 needs edge reuse.
- R2 public buckets can expose objects through a custom domain or an `r2.dev` development URL, but buckets are private by default and public access must be explicitly enabled. Public custom domains can use Cloudflare Cache, WAF, and access controls, but the bucket contents are still reachable through that public surface.

## 4. Target Model

### 4.1 First-Release Flow

```txt
1. POST /media
   - Authenticate actor.
   - Validate filename, alt, declared content type, and declared byte size.
   - Generate media ID and object key: media/{mediaId}/original.
   - Create media row with status pending_upload and owner relationship.
   - Reserve idempotency result when Idempotency-Key is present.
   - Return media plus upload instructions.

2. Client PUTs directly to the returned R2 presigned URL
   - Client must send the signed Content-Type header.
   - R2 writes media/{mediaId}/original.
   - R2 emits object-create notification to the media-processing queue.

3. workers/media-processor consumes the queue message
   - Validate event shape and key convention.
   - Load media by ID or originalKey.
   - Skip idempotently if media is not pending_upload.
   - Head the R2 object and compare actual metadata with declared metadata.
   - Transition media to processing.
   - Generate a tiny blurred lowResUrl placeholder from the original stream.
   - Generate fixed variants and write them to private R2.
   - Mark media ready when valid.
   - Mark media failed when the uploaded object violates validation.

4. Client polls GET /media/{id}
   - Owner/admin can see pending, failed, expired, private, and ready media they can read.
   - Anonymous actors can only read public ready media.

5. Client renders GET /media/{id}/v/{version}/variants/{name}
   - Route checks media readiness and visibility.
   - Route resolves the private R2 variant key.
   - Route streams the R2 variant object back to the client.
   - Public ready variants are edge-cached by versioned URL.
```

### 4.2 Non-Goals For R1

- No arbitrary user-defined image transform parameters.
- No public R2 bucket.
- No client-selected object keys.
- No request-time image transformation in API routes.
- No `POST /media/:id/complete` fast path unless architecture review explicitly chooses it before implementation starts.
- No multipart upload support in R1.
- No video, SVG, PDF, or non-image uploads.
- No compatibility migration for old metadata-only rows; there is no production data.

### 4.3 Earlier Options Superseded By This Plan

| Topic | Earlier option | This proposal | Reason |
|---|---|---|---|
| Completion | Keep `/complete` as fast client path and R2 events as reliability layer. | R1 is event-driven only. | Fewer public mutation endpoints and less double-start logic. R2 object-create event proves the object exists. |
| Variants | Generate and store fixed R2 variants through a queue job. | Accepted for R1: media processor generates fixed variants and stores them in private R2. | Avoid request-time transform cold starts and move image CPU away from user requests. |
| Statuses | `pending_upload -> processing -> ready`, plus `expired`, `failed`, `deleted`. | R1 uses `pending_upload -> processing -> ready`, `pending_upload -> expired`, `processing -> failed`, optional `ready -> deleted` if soft delete exists. | `processing` is useful because variant generation now happens before ready. |
| Variant route | `GET /media/:id/v/:version/variants/:name`. | Keep this versioned route. | Preserves future cache invalidation and aligns with architecture. |
| Bucket access | Variants may be served from R2 objects. | R2 stays private; all variants are served by the API Worker. | Avoid exposing originals or object keys through a public bucket. Keep one policy surface for public/private media. |

## 5. Architecture Decisions

### 5.1 Event-Driven Completion And Processor-Owned Variants

Recommended: no `POST /media/:id/complete` endpoint in R1.

The queue consumer is the single server-side completion path. It verifies the original, generates `lowResUrl`, generates all fixed variants, writes those variants to private R2, and only then marks media `ready`. This keeps routes thin and avoids a race where `/complete` and the R2 event both try to transition the same media row.

Status flow:

```txt
pending_upload
  -> processing    // processor has verified object and is generating derivatives
  -> ready         // lowResUrl and every required variant exists in R2

pending_upload -> expired
pending_upload -> failed
processing -> failed
```

Rationale:

- User-facing variant requests should not pay image transformation cold-start or CPU cost.
- API route latency should be mostly authz + cache lookup + R2 stream, not image processing.
- A media row should not become public-ready until all required derivatives are present.
- The processor Worker is the correct place for slower, retryable image work.

Rejected for R1: `/complete` plus R2 event fallback.

That design can reduce perceived latency because the client can notify the API immediately after upload. It also requires idempotent double-entry logic, an additional route, additional idempotency rules, and a second path that reads R2 and changes state. Add it later only if event latency becomes a real product problem.

### 5.2 Presigned PUT, Not Presigned POST

Recommended: generate presigned PUT URLs with signed `Content-Type` and short TTL.

Cloudflare R2 supports presigned PUT URLs. It does not currently support presigned POST form uploads, so do not design around POST policy conditions such as:

```txt
["content-length-range", 1, 10485760]
["starts-with", "$Content-Type", "image/"]
```

Those conditions should not appear in the implementation backlog. R1 must enforce upload constraints as follows:

- Pre-sign validation rejects unsupported declarations.
- PUT signing includes the exact expected `Content-Type`.
- The processor compares actual R2 object metadata with the media row before marking `ready`.
- Cleanup deletes or expires invalid and abandoned objects.

If strict upload-time byte rejection is required later, evaluate Worker-proxied upload or scoped temporary credentials. That is explicitly outside R1.

### 5.3 Processor-Generated Variants Through Images Binding

Recommended: transform private R2 originals in `workers/media-processor` through `env.IMAGES.input(original.body)`, then store every required variant in private R2.

Do not call:

```ts
const original = await env.MEDIA_R2.get(key);
return fetch(original, { cf: { image: variant } });
```

`env.MEDIA_R2.get()` returns an R2 object, not a URL or `Request`. The URL-based `cf.image` flow is useful when the source image is fetchable through an origin URL. For private R2 originals, use the Images binding.

The Images binding is used in the processor, not in the API variant route. The processor passes the R2 original's `ReadableStream` to Cloudflare's Images binding and writes each transformed result back to R2. It does not need to read the entire original into JavaScript memory. The only expected buffering is for the tiny `lowResUrl` data URL, because that value is intentionally stored in D1.

Required processor outputs before `markReady()`:

- `lowResUrl` data URL on the media row.
- `thumb` variant object in R2.
- `small` variant object in R2.
- `medium` variant object in R2.
- `large` variant object in R2.
- `og` variant object in R2.
- `blur` variant object in R2, if kept as a requestable variant separate from `lowResUrl`.

If any required transform or R2 write fails after Queue retries, mark media `failed`. Do not expose partially generated media as `ready`.

Two bucket access options were considered:

| Option | Verdict | Reason |
|---|---|---|
| Public R2 bucket + custom domain | Rejected for R1 | Lowest serving overhead for public assets, but it exposes an object-serving surface outside the API policy model. Private media, pending media, failed media, and originals become harder to reason about. |
| Private R2 bucket + API Worker variant route | Accepted | Keeps originals and variants private at storage, centralizes authz in `MediaPolicy`, lets public variants be cached at the Worker response layer, and supports private variants without issuing presigned GET URLs. |

Variant generation should:

- Use `MEDIA_VARIANTS` from the central constants module.
- Write only fixed variant names.
- Store content type, ETag, and byte size where useful for response headers.
- Be idempotent: if a variant key already exists for the same media version, overwrite or skip deterministically.
- Mark media `ready` only after all required variants are present.

### 5.4 Separate Queue Consumer Worker

Recommended: add `workers/media-processor/` as a separate Worker.

Reasons:

- Queue delivery and retry behavior are operationally separate from API request handling.
- The API Worker does not need a `queue()` export.
- Processor deploys can be independent once deployment automation supports multiple Workers.
- Processor dependencies can stay separate if future image analysis or cleanup code grows.

The processor still belongs to this repository and should reuse shared domain/application/persistence code where feasible. If TypeScript path aliases or architecture lint do not include `workers/**`, update the lint and typecheck plan before implementation rather than bypassing boundaries.

### 5.5 Store Upload Facts Separately From Served URLs

Recommended: keep R2 object keys and declared upload facts in the media row; derive served URLs in presenters.

Do not let the client submit permanent `url`, `thumbnailURL`, or R2 keys for new uploads. Upload-created rows should use:

- `originalKey`
- `uploadExpiresAt`
- `mimeType`
- `filesize`
- optional `width` and `height` after processor inspection
- `version`
- optional `failureReason`

Because this repo has no production media data yet, implementation does not need to preserve old metadata-only rows. The schema and tests can move directly to the upload-backed shape.

### 5.6 Central Media Constants

Recommended: define media upload and variant constants once and import them everywhere.

Use a central file such as `src/shared/media/media.constants.ts` for values needed by HTTP schemas, application validation, the processor Worker, and infrastructure code:

```ts
export const MEDIA_UPLOAD_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  uploadUrlTtlSeconds: 5 * 60,
} as const;

export const MEDIA_CONTENT_TYPES = ["image/png", "image/jpeg", "image/jpg"] as const;

export const MEDIA_VARIANTS = {
  thumb: { width: 160, height: 160, fit: "cover", format: "image/webp", quality: 75 },
  small: { width: 480, fit: "scale-down", format: "image/webp", quality: 80 },
  medium: { width: 960, fit: "scale-down", format: "image/webp", quality: 82 },
  large: { width: 1600, fit: "scale-down", format: "image/webp", quality: 85 },
  og: { width: 1200, height: 630, fit: "cover", format: "image/jpeg", quality: 85 },
  blur: { width: 48, fit: "scale-down", blur: 8, format: "image/webp", quality: 25 },
} as const;

export const MEDIA_LOW_RES_PLACEHOLDER = {
  width: 48,
  fit: "scale-down",
  blur: 8,
  format: "image/webp",
  quality: 25,
} as const;

export const MEDIA_OBJECT_KEYS = {
  rootPrefix: "media",
  originalName: "original",
  variantsPrefix: "variants",
} as const;
```

Do not scatter media dimensions, quality values, TTLs, byte limits, content types, or object key fragments through routes, use cases, workers, or tests.

### 5.7 API Variant Proxy, Streaming, And Cache

Recommended: keep the bucket private, pre-generate variants in R2, and make the API route a streaming variant gateway.

The API route is a proxy in the sense that clients request `GET /media/{id}/v/{version}/variants/{name}` from the API, not from R2. It should not proxy by reading a full image into memory. It should stream the R2 object's body:

```ts
const object = await storage.get(variantKey);
if (!object) throw new NotFoundError("Media variant not found");

return {
  body: object.body,
  headers: {
    "Content-Type": object.contentType,
    "Cache-Control": cacheControl,
    "ETag": object.etag,
  },
};
```

The HTTP route then returns the stream:

```ts
return new Response(result.body, {
  status: 200,
  headers: result.headers,
});
```

No `arrayBuffer()` is used for variant serving. The only image bytes that should be buffered are the tiny low-res placeholder generated by the processor for D1 storage.

Public cache path:

1. The route validates `{ id, version, name }`.
2. The route calls one `ServeMediaVariantUseCase`.
3. The use case confirms media is `ready`, `public`, and the requested version matches.
4. A cache adapter checks `caches.default` with a deterministic key based on the full versioned URL.
5. On cache hit, return the cached `Response`.
6. On cache miss, stream the R2 variant object and cache a cloned response with `ctx.waitUntil(cache.put(cacheKey, response.clone()))`.

Private cache path:

- Require actor.
- Check `MediaPolicy.canRead`.
- Stream the R2 variant object.
- Use `Cache-Control: private, max-age=60` or `no-store`.
- Do not write private responses to `caches.default`.

This is not as zero-hop as a public R2 custom domain. A public bucket can let Cloudflare serve cache hits without running this Worker route. The tradeoff is that a public bucket creates a second serving surface outside the API policy model. With pre-generated variants plus Cache API, public variant cache hits should be close enough for R1 while keeping the security model simple: R2 is private, originals are never public, and API policy controls every uncached miss.

For R1, we intentionally accept one Worker gateway hop for public variants in exchange for keeping R2 private and keeping all media access under the API policy model. If public media delivery becomes a measured bottleneck, we can later add a separate public immutable variant serving path while keeping originals private.

## 6. API Contract

### 6.1 Create Upload

Route:

```txt
POST /media
Authorization: Bearer <token>
Idempotency-Key: <optional-client-key>
```

Request body:

```json
{
  "alt": "Hero image",
  "filename": "hero.png",
  "contentType": "image/png",
  "size": 482331,
  "focalX": null,
  "focalY": null
}
```

Notes:

- Use `contentType` in the public schema. Map it to existing `mimeType` internally only if the entity keeps Payload-compatible naming.
- Use `size` in the public schema. Map it to existing `filesize` internally only if the entity keeps Payload-compatible naming.
- Allowed R1 content types should match the Payload spec unless product requirements expand it: `image/png`, `image/jpeg`, `image/jpg`. Treat `image/jpg` as an accepted alias but prefer storing `image/jpeg`.
- If adding `image/webp`, `image/gif`, or `image/avif`, update `docs/payloadcms-schema-spec.md` or explicitly document the divergence.

Response body:

```json
{
  "data": {
    "media": {
      "id": "media_123",
      "alt": "Hero image",
      "filename": "hero.png",
      "mimeType": "image/png",
      "filesize": 482331,
      "status": "pending_upload",
      "visibility": "private",
      "version": 1,
      "createdAt": "2026-05-18T04:00:00.000Z",
      "updatedAt": "2026-05-18T04:00:00.000Z"
    },
    "upload": {
      "method": "PUT",
      "url": "https://<account-id>.r2.cloudflarestorage.com/<bucket>/media/media_123/v1/original?...",
      "expiresAt": "2026-05-18T04:05:00.000Z",
      "headers": {
        "Content-Type": "image/png"
      }
    }
  }
}
```

Do not expose `originalKey` publicly by default. It can be useful for admin/debug responses, but the stable public contract should use API URLs.

Idempotency replay:

- Same actor, same key, same request hash returns the same `201` response payload including the cached upload instructions if the URL is still valid.
- If the replayed upload URL is expired, prefer returning `409` with a clear error and require a future refresh endpoint, or include a first-release `POST /media/:id/refresh-upload-url`. Do not silently mint a new URL from idempotency replay unless the behavior is documented and tested.

### 6.2 Get Media

Route:

```txt
GET /media/{id}
```

Response should include:

- `status`
- `visibility`
- `version`
- declared and verified metadata where available
- stable variant URLs only when `status === "ready"`

Example ready response:

```json
{
  "data": {
    "id": "media_123",
    "alt": "Hero image",
    "filename": "hero.png",
    "mimeType": "image/png",
    "filesize": 482331,
    "lowResUrl": "data:image/webp;base64,UklGR...",
    "width": 1280,
    "height": 720,
    "status": "ready",
    "visibility": "private",
    "variantUrls": {
      "thumb": "/media/media_123/v/1/variants/thumb",
      "medium": "/media/media_123/v/1/variants/medium",
      "og": "/media/media_123/v/1/variants/og"
    },
    "createdAt": "2026-05-18T04:00:00.000Z",
    "updatedAt": "2026-05-18T04:00:02.000Z"
  }
}
```

### 6.3 Publish And Unpublish

Existing routes remain:

```txt
POST /media/{id}/publish
POST /media/{id}/unpublish
```

New invariant:

- `publish()` must fail unless `media.status === "ready"`.
- `unpublish()` may work for any non-deleted media because it reduces exposure.

Use a shared application/domain error that maps to `409 Conflict` for invalid state transitions.

### 6.4 Serve Variant

Route:

```txt
GET /media/{id}/v/{version}/variants/{name}
```

Fixed R1 variants:

```ts
import { MEDIA_VARIANTS } from "@/shared/media/media.constants";
```

Route behavior:

- Unknown variant name: `404`.
- Version mismatch: `404` or `410`. Prefer `404` to avoid leaking media history.
- Missing media or unreadable media: existing error middleware behavior.
- Not ready: `404` for anonymous actors; `409` or media JSON status for owners through `GET /media/{id}`.
- Missing variant object for a ready row: `404` plus operator-visible log; this indicates data drift.
- The route streams the variant object's `ReadableStream`; it must not transform the original or buffer the full variant.

## 7. Data Model

### 7.1 Media Entity Fields

R1 should evolve `MediaProps` toward:

```ts
export type MediaStatus = "pending_upload" | "processing" | "ready" | "failed" | "expired";

export type MediaProps = {
  id: string;
  alt: string;
  owner: string;
  filename: string;
  mimeType: string;
  filesize: number;
  width: number | null;
  height: number | null;
  focalX: number | null;
  focalY: number | null;
  originalKey: string | null;
  variantKeys: Record<string, string>;
  uploadExpiresAt: Date | null;
  status: MediaStatus;
  visibility: "private" | "public";
  version: number;
  failureReason: string | null;
  lowResUrl: string | null; // generated data URL placeholder
  optimizedUrl: string | null;
  url: string | null;
  thumbnailURL: string | null;
  createdAt: Date;
  updatedAt: Date;
};
```

Migration notes:

- There is no production data yet, so the migration can make upload-backed fields required where the domain needs them.
- `url`, `thumbnailURL`, and `optimizedUrl` can be removed or left nullable only if they are still needed for Payload-compatible response shape.
- `lowResUrl` should remain nullable until the processor has generated it, then be set before `markReady()`.

### 7.2 Media Status State Machine

R1 state machine:

```txt
pending_upload ──object verified──▶ processing
processing ──────variants ready────▶ ready
pending_upload ──invalid object────▶ failed
processing ──────processing error──▶ failed
pending_upload ──upload expired────▶ expired
ready ──────────delete────────────▶ deleted (future if soft delete is added)
```

Domain lifecycle methods:

```ts
class Media {
  static beginUpload(input: BeginMediaUploadProps): Media;
  markProcessing(): void;
  markReady(input: { width?: number; height?: number; lowResUrl?: string }): void;
  markFailed(reason: string): void;
  markExpired(reason: string): void;
  publish(): void;
  unpublish(): void;
}
```

Required guards:

- `markProcessing()` requires `pending_upload`.
- `markReady()` requires `processing`.
- `markFailed()` requires `pending_upload`.
- `markFailed()` also accepts `processing`.
- `markExpired()` requires `pending_upload`.
- `publish()` requires `ready`.
- `beginUpload()` owns generated fields: `id`, `originalKey`, `status`, `visibility`, `version`, timestamps, and upload expiry.

### 7.3 Object Key Convention

R2 is a flat key-value namespace. Use prefix-like keys for operational clarity and lifecycle cleanup:

```txt
media/{mediaId}/v{version}/original
media/{mediaId}/v{version}/variants/thumb.webp
media/{mediaId}/v{version}/variants/small.webp
media/{mediaId}/v{version}/variants/medium.webp
media/{mediaId}/v{version}/variants/large.webp
media/{mediaId}/v{version}/variants/og.jpg
media/{mediaId}/v{version}/variants/blur.webp
```

R1 starts with `version = 1`. Keeping the original under the same version prefix avoids a future re-upload problem where `media/{mediaId}/original` points to newer content while old versioned variant URLs are still cached.

Rules:

- The client never chooses the object key.
- The original filename is stored only in D1.
- Event notification should use both prefix and suffix filtering when configured:

```sh
npx wrangler r2 bucket notification create content-api-media \
  --event-type object-create \
  --queue media-processing \
  --prefix "media/" \
  --suffix "/original"
```

If Cloudflare rejects the combination for the bucket due to overlapping rules, use the narrowest allowed rule and keep suffix validation inside the consumer.

## 8. Validation And Security Model

### 8.1 Pre-Sign Validation

The `CreateMediaUploadUseCase` validates before any DB write or presigned URL creation. Import constants from `src/shared/media/media.constants.ts`; do not redefine these values locally:

```ts
import { MEDIA_CONTENT_TYPES, MEDIA_UPLOAD_LIMITS } from "@/shared/media/media.constants";
```

Validation:

- `alt`: non-empty string.
- `filename`: non-empty string, stored for display only.
- `contentType`: exact allowlist match, with optional normalization from `image/jpg` to `image/jpeg`.
- `size`: positive integer and `<= MAX_IMAGE_UPLOAD_BYTES`.
- `focalX` and `focalY`: optional finite numbers; preserve existing schema semantics unless product requirements define bounds.

### 8.2 Signed Upload Requirements

The presigned PUT URL should sign:

- Bucket.
- Key.
- HTTP method `PUT`.
- Expiry.
- Exact `Content-Type` header.

Response must include the headers the client must send:

```json
{
  "headers": {
    "Content-Type": "image/png"
  }
}
```

Do not claim R2 rejects oversized uploads at PUT time from a `content-length-range` condition. R1 has no strict R2 upload-time byte-size gate.

### 8.3 Post-Upload Verification

The processor verifies before status transition:

- Event key matches `media/{mediaId}/original`.
- Event size is present and exactly matches declared `filesize`.
- `R2Bucket.head(originalKey)` returns an object.
- R2 HTTP metadata content type matches stored `mimeType`.
- Stored status is still `pending_upload`.
- `uploadExpiresAt` has not passed, or if it has passed, mark `expired` and optionally delete the object.
- Low-res placeholder generation succeeds, or the processor records a failure reason and leaves media non-public.
- Every required variant generation and R2 write succeeds before the media is marked `ready`.

If content type is missing from R2 metadata, do not mark ready. Mark failed with an operator-readable reason.

Low-res placeholder generation:

- Use `env.IMAGES.info(original.body)` to validate dimensions and image decodability where practical.
- Use `MEDIA_LOW_RES_PLACEHOLDER` to transform the original into a tiny blurred WebP.
- Convert the small result to a `data:image/webp;base64,...` string and store it in `media.lowResUrl`.
- If the Images binding cannot decode the original, mark media `failed`; a file that cannot be transformed as an image should not become public media.

### 8.4 Public Read Rules

Rules:

- Original objects are never public.
- Anonymous reads are allowed only for `ready` and `public` media.
- Private ready media can be served only after `MediaPolicy.canRead(actor, media)`.
- `pending_upload`, `failed`, and `expired` media are never publicly readable.
- Variant responses for public ready media can use long-lived public caching.
- Variant responses for private ready media should use short-lived private caching or no shared cache.

## 9. Implementation Plan

### 9.1 Domain Layer

Files:

- `src/domain/media/media.entity.ts`
- `src/domain/media/media.repository.ts`
- `src/domain/media/media.policy.ts`
- `src/domain/media/object-storage.ts` (new)
- `src/domain/media/image-transformer.ts` (new, optional if variant serving uses an application use case)
- `src/shared/media/media.constants.ts` (new)

Tasks:

- Expand `MediaStatus`.
- Add upload fields to `MediaProps`.
- Replace or supplement `Media.create()` with `Media.beginUpload()`.
- Add lifecycle methods and guards.
- Keep `CreateMediaProps = Omit<MediaProps, ...generated fields...>` style to satisfy architecture lint.
- Add shared media constants for content types, byte limits, TTLs, object key parts, placeholder config, and variants.
- Add storage interfaces in domain only if application use cases need them:

```ts
export interface ObjectStorage {
  head(key: string): Promise<{ size: number; contentType: string | null; etag?: string } | null>;
  get(key: string): Promise<{ body: ReadableStream; contentType: string | null; etag?: string } | null>;
  delete(key: string): Promise<void>;
}

export interface ObjectStorageSigner {
  createPresignedPutUrl(input: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string>;
}
```

### 9.2 Application Layer

Files:

- `src/application/media/create-media-upload.usecase.ts`
- `src/application/media/mark-media-upload-ready.usecase.ts`
- `src/application/media/mark-media-upload-failed.usecase.ts`
- `src/application/media/expire-media-upload.usecase.ts`
- `src/application/media/generate-media-low-res-placeholder.usecase.ts` or equivalent processor use case
- `src/application/media/generate-media-variants.usecase.ts` or equivalent processor use case
- `src/application/media/serve-media-variant.usecase.ts`
- Existing `get`, `list`, `update`, `publish`, `unpublish`, and `delete` use cases

Tasks:

- Rename or replace `CreateMediaUseCase` with `CreateMediaUploadUseCase`.
- Preserve existing idempotency behavior from `CreateMediaUseCase`.
- Store idempotency `responseJson` as the full HTTP-level success payload if upload instructions must replay.
- Build media and owner relationship before persistence.
- Keep authorization in `MediaPolicy`.
- Keep create workflow atomic through the existing `MediaCreateWorkflow` pattern.
- Add processor-oriented use cases that can be called from a queue consumer without Hono dependencies.
- Generate and persist `lowResUrl` and every required variant before marking media ready.
- Stream generated variant objects from private R2 through `ServeMediaVariantUseCase`.
- Add state-transition errors to `src/shared/errors.ts` instead of custom error classes in application code.

### 9.3 Infrastructure Persistence

Files:

- `src/infrastructure/db/schema.ts`
- `drizzle/*.sql`
- `src/infrastructure/repositories/drizzle-media.repository.ts`
- `src/infrastructure/repositories/drizzle-media-create.workflow.ts`
- `src/infrastructure/repositories/mappers/media.mapper.ts`

Schema additions:

```ts
originalKey: text("original_key"),
variantKeysJson: text("variant_keys_json", { mode: "json" }),
uploadExpiresAt: integer("upload_expires_at", { mode: "timestamp_ms" }),
version: integer("version").notNull().default(1),
failureReason: text("failure_reason"),
```

Migration guidance:

- There is no production data, so prefer a clean upload-backed schema over compatibility shims.
- Generated migrations can add/drop columns directly according to the target model.
- Ensure mappers explicitly map every new column.
- Consider an index on `(status, upload_expires_at)` for cleanup scans.
- Consider an index or unique index on `original_key` for event lookup.

Repository additions:

- `findByOriginalKey(key: string): Promise<Media | null>` if the processor should avoid parsing IDs.
- `findPendingExpired(now: Date, limit: number): Promise<Media[]>` for cleanup, if cleanup is included.

### 9.4 Infrastructure Storage

Files:

- `src/infrastructure/storage/r2-object-storage.ts`
- `src/infrastructure/storage/r2-presigned-url-signer.ts`
- `src/infrastructure/storage/r2-media-key-builder.ts`
- `src/infrastructure/cache/cloudflare-variant-cache.ts`
- `src/infrastructure/images/cloudflare-images-transformer.ts`

Recommended signer implementation:

- Prefer `aws4fetch` for Worker-compatible SigV4 signing if dependency size and type support are acceptable.
- Alternatively use `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, but validate bundle size and Worker compatibility before committing.
- Avoid hand-written SigV4 in R1 unless dependencies prove unusable.

Required config:

- `MEDIA_R2` binding for R2 object access.
- `R2_ACCOUNT_ID`
- `R2_BUCKET_NAME`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `MAX_IMAGE_UPLOAD_BYTES`
- `UPLOAD_URL_TTL_SECONDS`
- `IMAGES` binding for variant transforms.
CACHE binding is not required; use Workers Cache API (`caches.default`) through an infrastructure adapter for public variant responses.

Security note:

- R2 binding does not need API keys, but presigned URL generation does. Store signer credentials as secrets in deployed environments.

### 9.5 HTTP Layer

Files:

- `src/http/routes/media.routes.ts`
- `src/http/schemas/media.schema.ts`
- `src/http/presenters/media.presenter.ts`
- `src/http/openapi.ts` if binary response helpers are needed

Tasks:

- Keep route handlers thin and use `c.req.valid(...)`.
- `POST /media` calls exactly one create-upload use case.
- Response schema should document `{ data: { media, upload } }`, not only `{ data: media }`.
- Add `GET /media/{id}/v/{version}/variants/{name}`.
- Prefer a dedicated `ServeMediaVariantUseCase` if variant serving needs multiple operations. The route should still call exactly one use case.
- Binary route OpenAPI response should declare image media types rather than JSON data envelopes.
- Do not import R2, Images, Drizzle, or storage implementation directly into routes.
- Present `lowResUrl` on ready media so UI clients can render a blur-up placeholder without an extra request.
- Route returns a `Response` from the stream descriptor produced by the use case; it must not call `arrayBuffer()` for variant objects.

### 9.6 Composition And Config

Files:

- `src/config/env.ts`
- `src/composition/create-request-container.ts`
- `src/http/app-env.ts`

Tasks:

- Extend `AppBindings` with `MEDIA_R2: R2Bucket` and `IMAGES`.
- Validate string config through `parseEnv`.
- Validate binding presence with runtime checks that do not pretend bindings are strings.
- Wire `R2ObjectStorage`, `R2PresignedUrlSigner`, and image transformer into use cases.
- Keep request-scoped wiring in `create-request-container.ts`.

### 9.7 Media Processor Worker

Location:

```txt
workers/media-processor/
  src/index.ts
  src/config.ts
  wrangler.jsonc
  tsconfig.json
```

Bindings:

- `DB`
- `MEDIA_R2`
- `IMAGES`

Consumer responsibilities:

- Parse and validate R2 event notification messages.
- Process only `object-create` actions.
- Ignore keys that do not match `media/{mediaId}/original`.
- Load the media row.
- Skip and ack when media is missing, already ready, failed, expired, or deleted.
- Verify object metadata.
- Generate low-res placeholder from the original image.
- Generate all fixed variants through the Images binding and write them under the versioned variant prefix.
- Call application use case to mark ready or failed.
- Rely on Queue retry for transient failures.
- Do not make authorization decisions; use a system path/use case for background transitions.

Minimal event type:

```ts
type R2ObjectCreatedEvent = {
  account: string;
  action: "PutObject" | "CopyObject" | "CompleteMultipartUpload";
  bucket: string;
  object: {
    key: string;
    size?: number;
    eTag?: string;
  };
  eventTime: string;
};
```

### 9.8 Wrangler And Cloudflare Setup

API Worker `wrangler.jsonc` additions:

```jsonc
{
  "r2_buckets": [
    { "binding": "MEDIA_R2", "bucket_name": "content-api-media" }
  ],
  "images": {
    "binding": "IMAGES"
  },
  "vars": {
    "R2_ACCOUNT_ID": "<account-id>",
    "R2_BUCKET_NAME": "content-api-media",
    "MAX_IMAGE_UPLOAD_BYTES": "10485760",
    "UPLOAD_URL_TTL_SECONDS": "300"
  }
}
```

Secrets:

```sh
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

One-time setup:

```sh
npx wrangler r2 bucket create content-api-media
npx wrangler queues create media-processing
npx wrangler r2 bucket notification create content-api-media \
  --event-type object-create \
  --queue media-processing \
  --prefix "media/" \
  --suffix "/original"
```

Worker config must be duplicated or factored carefully because `workers/media-processor` has its own deploy unit.

### 9.9 Documentation Updates

Files:

- `README.md`
- `docs/architecture.md`
- `docs/payloadcms-schema-spec.md` if MIME types diverge
- `.agents/skills/content-api-architecture/references/architecture-rules.md` only if architecture lint rules or documented boundaries must change

Required updates after approval:

- Keep architecture docs aligned if R1 completion or variant strategy changes.
- Add R2, Images, and worker setup to local/deploy docs.
- Keep "Not Implemented" accurate until code lands.

## 10. Test And Verification Plan

Unit tests:

- `Media.beginUpload()` sets generated fields and defaults.
- `markReady()`, `markFailed()`, and `markExpired()` enforce valid source statuses.
- `publish()` rejects non-ready media.
- Content-type normalization accepts `image/jpg` and stores `image/jpeg`, if normalization is implemented.

Use case tests:

- Create upload rejects unsupported content type.
- Create upload rejects size over `MAX_IMAGE_UPLOAD_BYTES`.
- Create upload creates `pending_upload` media plus owner relationship.
- Create upload returns signed upload instructions with required headers.
- Idempotency replay returns the cached response for the same request hash.
- Idempotency conflict returns `409` for same key and different request body.
- Mark-ready use case rejects missing media, missing object, wrong content type, size mismatch, and expired upload.

HTTP tests:

- `POST /media` OpenAPI includes `Idempotency-Key`.
- `POST /media` returns `{ data: { media, upload } }`.
- `GET /media/{id}` returns pending status to owner but not anonymous actor.
- `POST /media/{id}/publish` returns `409` for pending media.
- Anonymous can read public ready media.
- Anonymous cannot read pending, failed, expired, or private media.
- Variant route returns binary response for ready readable media.
- Variant route returns `404` for unknown variant, version mismatch, missing generated variant, or unreadable public request.

Queue tests:

- Simulated R2 object-created message transitions pending media to ready.
- Duplicate event is acked and does not change ready media.
- Invalid key is acked and skipped.
- Missing content type marks failed.
- Actual object size mismatch marks failed.
- Expired pending upload marks expired.
- Variant generation or variant R2 write failure keeps media from becoming ready and eventually marks failed after retries.
- Transient D1/R2 errors are not acked so Queue retry can happen.

Integration/local tests:

- Continue using `@cloudflare/vitest-pool-workers`; it runs tests inside the Workers runtime and provides local bindings for D1/R2 through Miniflare.
- Add an R2 binding to the test Wrangler config and seed objects through `cloudflare:test` `env.MEDIA_R2` or a thin test helper.
- Test Queue consumers by calling the exported consumer handler with fake `MessageBatch` objects first; add end-to-end Queue integration only if the local pool supports the needed queue behavior reliably.
- Images binding tests should primarily mock the image transformer behind an application/domain interface. Add one local low-fidelity Images binding smoke test for wiring only.
- Do not depend on real Cloudflare R2, Images, or Queues in the default `pnpm test` path.
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`

Manual smoke after implementation:

1. `pnpm db:generate`
2. `pnpm db:migrate:local`
3. `pnpm dev`
4. Create upload.
5. PUT file with required `Content-Type`.
6. Trigger or simulate R2 event.
7. Confirm media becomes ready.
8. Publish media.
9. Fetch a variant URL.

## 11. Edge Cases And Failure Modes

| Scenario | Expected behavior |
|---|---|
| Client never uploads | Media remains `pending_upload` until cleanup marks `expired`. |
| Upload URL expires before PUT | R2 rejects the PUT. Media eventually expires. |
| Client sends wrong `Content-Type` header | R2 signed-header validation should reject with signature error. |
| Client uploads correct content type but too many bytes | R2 may accept the PUT. Processor marks media `failed` or `expired` according to timing, then cleanup deletes the object. |
| R2 event arrives after `uploadExpiresAt` | Processor marks expired and deletes the object if cleanup behavior is in scope. |
| R2 event is duplicated | Processor sees non-pending status and acks without changes. |
| R2 event has no content type | Processor heads object; if still missing, mark failed. |
| R2 event has key outside `media/{id}/original` | Ack and skip. |
| DB row missing for object key | Ack and record operator-visible log; future cleanup removes orphan object. |
| DB row exists but R2 object missing | Keep pending until expiry or mark failed from explicit processor path. |
| Media is published while pending | Domain rejects with invalid state. |
| Images binding unavailable | Variant route returns `503` or configured application error; do not serve raw original publicly as a silent fallback. |
| Image transform fails in processor | Keep media non-ready and mark `failed` after retries; do not expose partial variants. |
| Low-res placeholder generation fails | Mark media `failed`; the uploaded object did not pass the image-processing gate. |
| Variant generation or R2 write fails | Keep media in `processing` during retries; mark `failed` if retries are exhausted and clean up partial variants later. |
| Queue backlog delays readiness | Client polling sees `pending_upload`; no client-side completion endpoint exists in R1. |
| Public R2 bucket accidentally enabled | Treat as deployment/configuration error; originals must not be exposed through direct R2 URLs. |

## 12. Implementation Backlog

### R1-A. Align Architecture Decision

Scope:

- `docs/architecture.md`
- `docs/002_media-upload-flow.md`

Tasks:

- Keep R1 event-only with no `/complete`.
- Keep R1 private-bucket only.
- Keep R1 processor-generated variants stored in private R2.
- Update `docs/architecture.md` to match this proposal.

Acceptance criteria:

- Architecture docs no longer disagree on upload completion and variant generation.

Tests:

- Documentation review only.

### R1-B. Domain Upload Lifecycle

Scope:

- `src/domain/media/media.entity.ts`
- `src/domain/media/media.repository.ts`
- `src/domain/media/media.policy.ts`

Tasks:

- Add upload fields and expanded statuses.
- Add lifecycle methods and guards.
- Add repository methods needed by processor and cleanup.
- Add `src/shared/media/media.constants.ts`.
- Keep entity class rules compatible with architecture lint.

Acceptance criteria:

- Pending media cannot be published.
- Ready transition is only possible from pending media.
- Media magic numbers are imported from the shared constants module.

Tests:

- Entity unit tests.
- Policy tests for public/private/status read rules.

### R1-C. Persistence Migration And Mappers

Scope:

- `src/infrastructure/db/schema.ts`
- `drizzle/*.sql`
- `src/infrastructure/repositories/drizzle-media.repository.ts`
- `src/infrastructure/repositories/mappers/media.mapper.ts`
- `src/infrastructure/repositories/drizzle-media-create.workflow.ts`

Tasks:

- Add columns and indexes.
- Update mappers explicitly.
- Add lookup by `originalKey` if selected.

Acceptance criteria:

- Tests seed upload-backed media rows.
- Schema reflects target upload-backed media model without compatibility-only columns unless still needed by API contract.

Tests:

- Repository integration tests.
- Existing `tests/api.test.ts` adjusted for new schema.

### R1-D. Storage And Signer

Scope:

- `src/domain/media/object-storage.ts`
- `src/infrastructure/storage/r2-object-storage.ts`
- `src/infrastructure/storage/r2-presigned-url-signer.ts`
- `src/config/env.ts`

Tasks:

- Add object storage and signer interfaces.
- Implement R2 storage through binding.
- Implement presigned PUT signer.
- Validate signer config and upload limits.

Acceptance criteria:

- Generated upload instructions include URL, method, expiry, and required headers.
- No R2 implementation leaks into routes or use cases except through interfaces.

Tests:

- Signer unit tests for URL shape and headers.
- Config validation tests.

### R1-E. Create Upload API

Scope:

- `src/application/media/create-media-upload.usecase.ts`
- `src/http/routes/media.routes.ts`
- `src/http/schemas/media.schema.ts`
- `src/http/presenters/media.presenter.ts`
- `src/composition/create-request-container.ts`

Tasks:

- Replace metadata create with upload create.
- Preserve idempotency.
- Update OpenAPI response schemas.
- Present variant URLs only when ready.

Acceptance criteria:

- `POST /media` no longer accepts client-supplied permanent URLs for upload-created media.
- API response documents upload instructions.

Tests:

- HTTP create-upload tests.
- Idempotency tests.
- OpenAPI route tests.

### R1-F. Processor Worker

Scope:

- `workers/media-processor/**`
- shared application/domain/infrastructure modules as needed

Tasks:

- Add Worker config and TypeScript setup.
- Add Queue consumer.
- Verify object metadata.
- Generate and store `lowResUrl`.
- Generate and store all fixed variants in private R2.
- Transition media status through use cases.
- Define retry/ack behavior.

Acceptance criteria:

- Simulated R2 event marks valid pending media ready.
- Invalid uploads become failed.
- Duplicate events are idempotent.
- Valid uploads produce a low-res placeholder before ready.
- Valid uploads produce every required variant object before ready.

Tests:

- Queue consumer tests with fake R2 and D1.

### R1-G. Variant Serving

Scope:

- `src/application/media/serve-media-variant.usecase.ts`
- `src/infrastructure/cache/cloudflare-variant-cache.ts`
- `src/infrastructure/storage/r2-object-storage.ts`
- `src/http/routes/media.routes.ts`
- `src/http/schemas/media.schema.ts`
- `wrangler.jsonc`

Tasks:

- Add versioned variant route.
- Stream generated variant objects from private R2.
- Add cache headers.
- Cache only public ready variant responses.

Acceptance criteria:

- Ready readable media can serve fixed variants.
- Unknown variants and non-ready media do not expose originals.
- No direct public R2 URL is returned for originals or variants.

Tests:

- Variant route tests with fake storage/cache.
- Access-control tests for anonymous/private cases.

### R1-H. Setup And Documentation

Scope:

- `README.md`
- `wrangler.jsonc`
- `workers/media-processor/wrangler.jsonc`
- deployment docs or disabled workflow notes

Tasks:

- Document R2 bucket, Queue, event notification, Images binding, and secrets.
- Keep README "Not Implemented" section accurate until code lands.
- Add commands for setup and smoke testing.

Acceptance criteria:

- A different engineer can configure local/remote resources without rediscovering required bindings.

Tests:

- Documentation review.

## 13. Future Backlog

- Add `POST /media/{id}/complete` if queue latency creates poor user experience.
- Add `POST /media/{id}/refresh-upload-url` for pending uploads whose URL expired.
- Add a public R2 custom domain only if the product later accepts public object URLs and the security model is redesigned around that exposure.
- Add object checksum validation if clients can provide trustworthy checksums.
- Add multipart upload support for larger files.
- Add scheduled cleanup Worker for expired media and orphaned R2 objects.
- Add reprocess endpoint for failed/ready media.
- Add audit logs for media upload ready, failed, expired, publish, unpublish, and delete events.
- Add soft delete and R2 object deletion workflow.

## 14. Definition Of Done

- `docs/architecture.md` and this proposal agree on R1 completion and variant strategy.
- `POST /media` creates `pending_upload` media and returns presigned R2 PUT instructions.
- Presigned upload URL signs the expected `Content-Type` and uses a short TTL.
- The implementation does not claim R2 enforces `content-length-range` for presigned PUT.
- Media constants live in one shared module and no media limits/dimensions/qualities are duplicated as local magic numbers.
- R2 event notification to Queue is configured with the narrowest possible key filter.
- `workers/media-processor` verifies uploaded object metadata, generates `lowResUrl`, writes every required variant to R2, and transitions media through `processing` to `ready`, `failed`, or `expired`.
- `publish()` rejects non-ready media.
- Public reads expose only public ready media.
- Variant route streams generated private R2 variant objects and never transforms images on request.
- No direct public R2 URL is returned for originals or variants.
- README documents the new bindings and setup once code is implemented.
- `corepack pnpm lint`, `corepack pnpm typecheck`, and `corepack pnpm test` pass.

## 15. Final Model

R1 should be a small, reliable upload pipeline:

```txt
HTTP create upload
  -> use case validates declaration and creates pending media
  -> infrastructure signer returns presigned R2 PUT URL
  -> client uploads directly to generated R2 key
  -> R2 event notification enters Queue
  -> media-processor verifies object, generates lowResUrl and variants, marks media ready
  -> API streams generated private R2 variants with public/private cache rules
```

The important changes are not only feature additions. The plan must preserve existing clean-architecture boundaries: routes validate and call one use case, use cases own authorization and state transitions, infrastructure owns R2/D1/Images details, and mappers remain the only row/entity conversion layer.
