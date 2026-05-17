# CMS API Architecture — Finalized

> **Status:** Finalized pre-implementation specification
>
> **Date:** 2026-05-17
>
> **Consolidates:**
> - `cms-api-repository-rebac-architecture.md`
> - `immediate-changes.md`
> - `media-upload-transformation-process.md`
> - `validation-schema-strategy.md`
> - `implementation-readiness-recommendations.md`
>
> **Context:** Hono API on Cloudflare Workers, D1/Drizzle persistence, R2 object storage, Cloudflare Queues for async processing.

---

## Table Of Contents

- [1. System Overview](#1-system-overview)
- [2. Folder Structure](#2-folder-structure)
- [3. Architecture Layers](#3-architecture-layers)
- [4. Request-Scoped Composition Container](#4-request-scoped-composition-container)
- [5. Resource Categorization & Shared CRUD](#5-resource-categorization--shared-crud)
- [6. Domain Entities & Repository Pattern](#6-domain-entities--repository-pattern)
- [7. ReBAC Authorization](#7-rebac-authorization)
- [8. Policies](#8-policies)
- [9. Use Cases](#9-use-cases)
- [10. Actor Model](#10-actor-model)
- [11. Hono Route Layer](#11-hono-route-layer)
- [12. Presenters](#12-presenters)
- [13. Validation & Schema Strategy](#13-validation--schema-strategy)
- [14. Media Upload & Transformation Pipeline](#14-media-upload--transformation-pipeline)
- [15. Media Public/Private Visibility](#15-media-publicprivate-visibility)
- [16. Error Contract](#16-error-contract)
- [17. Idempotency](#17-idempotency)
- [18. Transaction & Partial-Write Policy](#18-transaction--partial-write-policy)
- [19. Queue Messages](#19-queue-messages)
- [20. Audit Logging](#20-audit-logging)
- [21. Pagination, Filtering & Sorting](#21-pagination-filtering--sorting)
- [22. Import Boundaries](#22-import-boundaries)
- [23. Environment & Config Validation](#23-environment--config-validation)
- [24. Testing Strategy](#24-testing-strategy)
- [25. Persistence Model](#25-persistence-model)
- [26. Edge Cases & Failure Modes](#26-edge-cases--failure-modes)
- [27. Final Target Model](#27-final-target-model)

---

## 1. System Overview

The CMS API is a Hono backend deployed as a Cloudflare Worker with D1 for persistence, Drizzle as the query layer, R2 for object storage, and Cloudflare Queues for async processing.

**Resource hierarchy:**

```txt
site
  collection
    entry

site
  media

site
  membership

site
  api key
```

Most access-control questions are relationship questions:

```txt
Can user:u1 update entry:e1?
Can user:u2 publish entry:e1?
Can user:u3 upload media to site:s1?
Can api-key:k1 read published entries from site:s1?
```

These require both domain resource data (which site owns the entry, entry status, author) and relationship data (is the actor an owner/editor/writer/viewer of the site). The correct integration point is the application use case.

**Design goal — prevent this anti-pattern:**

```ts
app.patch('/entries/:entryId', async (c) => {
  // parse user → parse body → query entry → check role → check author
  // → check site membership → update DB → emit audit log → return JSON
})
```

**Target design:**

```txt
HTTP route
  -> use case
    -> entry repository (load)
    -> entry policy (check)
       -> relationship repository
    -> entry repository (save)
```

---

## 2. Folder Structure

```
src/
  main.ts

  http/
    routes/
    middleware/
    schemas/
    presenters/

  application/
    entries/
    media/
    sites/
    crud/

  domain/
    entries/
    media/
    sites/
    storage/
    authz/

  infrastructure/
    db/
    repositories/
    persistence/
    storage/
    queues/

  composition/
    create-request-container.ts

  shared/
    errors.ts
    result.ts
    validation/
```

**Boundary rules:**

| Layer | May import |
|-------|-----------|
| `http/*` | `application/*`, `composition/*` |
| `application/*` | `domain/*`, `shared/*` |
| `domain/*` | `shared/*` only |
| `infrastructure/*` | `domain/*` interfaces (to implement), `shared/*` |
| `composition/*` | `application/*`, `infrastructure/*`, `domain/*` |

`domain/**` must not import `infrastructure/**` or `http/**`.
`application/**` must not import `http/**`.
`http/**` must not import `infrastructure/db/**`.

---

## 3. Architecture Layers

### Repositories (domain level interfaces + infrastructure implementations)

- Fetch and persist domain objects.
- Map database rows to domain entities.
- **Must not:** decide permissions, know about Hono context, inspect request bodies.

Repository interface (in `domain/`):

```ts
// domain/entries/entry.repository.ts
export interface EntryRepository {
  findById(id: string): Promise<Entry | null>
  findBySiteAndId(params: { siteId: string; entryId: string }): Promise<Entry | null>
  save(entry: Entry): Promise<void>
  delete(id: string): Promise<void>
}
```

Implementation (in `infrastructure/repositories/`):

```ts
// infrastructure/repositories/drizzle-entry.repository.ts
export class DrizzleEntryRepository implements EntryRepository {
  constructor(private db: Db) {}
  // ... Drizzle queries, row-to-entity mapping
}
```

### Policies (domain level)

- Accept an actor and a domain object.
- Ask the relationship repository for relationship facts.
- Return `true`/`false` or throw through an assertion helper.
- **Must not:** import Hono, Drizzle, or mutate domain state.

### Use Cases (application level)

Where domain repositories and ReBAC policies meet:

```txt
Use case loads domain object.
Use case checks policy.
Use case mutates domain object.
Use case persists domain object.
```

### Routes (HTTP level)

- Authenticate through middleware.
- Validate HTTP input (via Zod schemas).
- Extract params.
- Call use case through the request container.
- Return JSON via presenters.
- **Must not:** query Drizzle directly, check relationships directly, know role rules, or mutate domain entities directly.

---

## 4. Request-Scoped Composition Container

A single request-scoped container wires dependencies. Routes call `createRequestContainer(c.env)`.

Located at `src/composition/create-request-container.ts` (NOT inside `application/`).

```ts
export function createRequestContainer(env: Env) {
  const db = createDb(env.DB)
  const relationships = new DrizzleRelationshipRepository(db)

  return {
    entries: {
      update: new UpdateEntryUseCase(
        new DrizzleEntryRepository(db),
        new EntryPolicy(relationships)
      ),
      publish: new PublishEntryUseCase(
        new DrizzleEntryRepository(db),
        new EntryPolicy(relationships)
      ),
      delete: new DeleteEntryUseCase(
        new DrizzleEntryRepository(db),
        new EntryPolicy(relationships)
      ),
    },
    media: {
      createUpload: new CreateMediaUploadUseCase(
        new DrizzleMediaRepository(db),
        new MediaPolicy(relationships),
        new R2ObjectStorage(env.R2),
        new R2PresignedUrlSigner(env)
      ),
      completeUpload: new CompleteMediaUploadUseCase(/* ... */),
    },
    sites: {
      update: /* ... */,
    },
  }
}
```

This keeps route files small and avoids repeated repository/policy construction.

---

## 5. Resource Categorization & Shared CRUD

Resources are split into two categories:

### Simple CRUD resources (~60%)

Use a shared CRUD adapter. Do not write domain-heavy use cases.

```
tags
redirects
site settings
collection fields
webhook endpoints
basic config tables
```

### Domain workflow resources (~40%)

Use explicit use cases for lifecycle, authorization, side effects, or multi-write workflows.

```
entries
publishing
media upload lifecycle
memberships
API keys
ReBAC relationship changes
ownership changes
```

**Rule:** CRUD for simple records. Use cases for lifecycle, authorization, side effects, or multi-write workflows.

### Shared CRUD Adapter

Located at `src/infrastructure/persistence/crud-adapter.ts`. Used internally inside repositories or generic CRUD use cases. Never expose generic CRUD directly to routes as the main architecture.

### Declarative CRUD Resource Config

For simple resources, declare allowed filters and sorts:

```ts
// src/application/crud/crud-resource.config.ts
export const mediaCrudConfig = {
  table: 'media',
  filters: {
    status: { column: 'status', op: 'eq' },
    contentType: { column: 'content_type', op: 'eq' },
  },
  sort: {
    allowed: ['created_at', 'updated_at', 'filename'],
    default: { field: 'created_at', direction: 'desc' },
  },
  pagination: {
    mode: 'cursor',
    cursorFields: ['created_at', 'id'],
    defaultLimit: 20,
    maxLimit: 100,
  },
} as const
```

---

## 6. Domain Entities & Repository Pattern

### Entry Entity

```ts
// domain/entries/entry.entity.ts
export type EntryStatus = 'draft' | 'published' | 'archived'

export type EntryProps = {
  id: string
  siteId: string
  collectionId: string
  authorId: string
  title: string
  slug: string
  body: unknown
  status: EntryStatus
  createdAt: Date
  updatedAt: Date
  publishedAt: Date | null
}

export class Entry {
  constructor(private props: EntryProps) {}

  get id() { return this.props.id }
  get siteId() { return this.props.siteId }
  get authorId() { return this.props.authorId }
  get status() { return this.props.status }

  update(input: { title?: string; slug?: string; body?: unknown }) {
    if (input.title !== undefined) this.props.title = input.title
    if (input.slug !== undefined) this.props.slug = input.slug
    if (input.body !== undefined) this.props.body = input.body
    this.props.updatedAt = new Date()
  }

  publish() {
    if (!this.props.title || !this.props.slug) {
      throw new Error('Entry cannot be published without title and slug')
    }
    this.props.status = 'published'
    this.props.publishedAt = new Date()
    this.props.updatedAt = new Date()
  }

  unpublish() {
    this.props.status = 'draft'
    this.props.publishedAt = null
    this.props.updatedAt = new Date()
  }

  toJSON() { return { ...this.props } }
}
```

### Media Entity

```ts
// domain/media/media.entity.ts
export type MediaStatus =
  | 'pending_upload'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'expired'
  | 'deleted'

export type MediaVisibility = 'private' | 'public'

export class Media {
  constructor(private props: {
    id: string
    originalKey: string
    filename: string
    contentType: string
    size: number
    status: MediaStatus
    visibility: MediaVisibility
    version: number
    createdBy: string
    createdAt: Date
    updatedAt: Date
  }) {}

  markReady() {
    if (this.props.status !== 'processing') {
      throw new DomainError('Media must be processing before it can be ready')
    }
    this.props.status = 'ready'
  }

  publish() { this.props.visibility = 'public' }
  unpublish() { this.props.visibility = 'private' }
}
```

**Principle:** Entities own state transitions. Policies own whether an actor may call the transition. Repositories own persistence.

---

## 7. ReBAC Authorization

### Relationship Entity

```ts
// domain/authz/relationship.entity.ts
export type SubjectType = 'user' | 'api_key' | 'entry' | 'collection' | 'site'
export type ObjectType = 'user' | 'site' | 'collection' | 'entry' | 'media'

export type Relation =
  | 'owner' | 'admin' | 'editor' | 'writer' | 'viewer'
  | 'author' | 'parent' | 'member'

export type Relationship = {
  subjectType: SubjectType
  subjectId: string
  relation: Relation
  objectType: ObjectType
  objectId: string
}
```

### Relationship Repository Interface

```ts
// domain/authz/relationship.repository.ts
export interface RelationshipRepository {
  exists(relationship: Relationship): Promise<boolean>

  findRelations(params: {
    subjectType: string
    subjectId: string
    objectType: string
    objectId: string
  }): Promise<string[]>

  hasAnyRelation(params: {
    subjectType: string
    subjectId: string
    objectType: string
    objectId: string
    relations: string[]
  }): Promise<boolean>

  create(relationship: Relationship): Promise<void>
  delete(relationship: Relationship): Promise<void>
}
```

**Important:** `hasAnyRelation` provides a batched check to avoid making multiple `exists()` calls in policies. See [§8](#8-policies) for usage.

### Example Relationship Facts

```txt
user:u1 owner    site:s1
user:u2 editor   site:s1
user:u3 writer   site:s1
user:u3 author   entry:e1
entry:e1 parent  collection:c1
collection:c1 parent site:s1
media:m1 parent  site:s1
user:u4 viewer   site:s1
```

**First-release simplification:** Most policy checks resolve through direct site-level relationships. Do not implement arbitrary recursive graph traversal unless required.

---

## 8. Policies

### Entry Policy

```ts
// domain/entries/entry.policy.ts
export class EntryPolicy {
  constructor(private relationships: RelationshipRepository) {}

  async canRead(actor: Actor, entry: Entry): Promise<boolean> {
    return this.relationships.hasAnyRelation({
      subjectType: actor.type,
      subjectId: actor.id,
      objectType: 'site',
      objectId: entry.siteId,
      relations: ['owner', 'admin', 'editor', 'writer', 'viewer'],
    })
  }

  async canUpdate(actor: Actor, entry: Entry): Promise<boolean> {
    // Site-level editors/admins/owners can always update
    if (await this.relationships.hasAnyRelation({
      subjectType: actor.type,
      subjectId: actor.id,
      objectType: 'site',
      objectId: entry.siteId,
      relations: ['owner', 'admin', 'editor'],
    })) return true

    // Author can update own draft
    if (entry.status === 'draft') {
      return this.relationships.exists({
        subjectType: 'user',
        subjectId: actor.id,
        relation: 'author',
        objectType: 'entry',
        objectId: entry.id,
      })
    }
    return false
  }

  async canPublish(actor: Actor, entry: Entry): Promise<boolean> {
    return this.relationships.hasAnyRelation({
      subjectType: actor.type,
      subjectId: actor.id,
      objectType: 'site',
      objectId: entry.siteId,
      relations: ['owner', 'admin', 'editor'],
    })
  }

  async canDelete(actor: Actor, entry: Entry): Promise<boolean> {
    return this.relationships.hasAnyRelation({
      subjectType: actor.type,
      subjectId: actor.id,
      objectType: 'site',
      objectId: entry.siteId,
      relations: ['owner', 'admin'],
    })
  }
}
```

### Media Policy

```ts
// domain/media/media.policy.ts
export class MediaPolicy {
  constructor(private relationships: RelationshipRepository) {}

  async canRead(actor: Actor, media: Media): Promise<boolean> {
    // Public ready media is readable by anyone
    if (media.visibility === 'public' && media.status === 'ready') return true

    return this.relationships.hasAnyRelation({
      subjectType: actor.type,
      subjectId: actor.id,
      objectType: 'site',
      objectId: media.siteId,
      relations: ['owner', 'admin', 'editor', 'writer', 'viewer'],
    })
  }

  async canUpdate(actor: Actor, media: Media): Promise<boolean> {
    return this.relationships.hasAnyRelation({
      subjectType: actor.type,
      subjectId: actor.id,
      objectType: 'site',
      objectId: media.siteId,
      relations: ['owner', 'admin', 'editor'],
    })
  }

  async canDelete(actor: Actor, media: Media): Promise<boolean> {
    return this.relationships.hasAnyRelation({
      subjectType: actor.type,
      subjectId: actor.id,
      objectType: 'site',
      objectId: media.siteId,
      relations: ['owner', 'admin'],
    })
  }

  async canPublish(actor: Actor, media: Media): Promise<boolean> {
    return this.relationships.hasAnyRelation({
      subjectType: actor.type,
      subjectId: actor.id,
      objectType: 'site',
      objectId: media.siteId,
      relations: ['owner', 'admin', 'editor'],
    })
  }
}
```

### Assertion Helper

```ts
// domain/authz/assert-can.ts
export async function assertAllowed(
  allowed: Promise<boolean>,
  message = 'Forbidden'
): Promise<void> {
  if (!(await allowed)) {
    throw new ForbiddenError(message)
  }
}
```

Usage in use cases:

```ts
await assertAllowed(
  entryPolicy.canUpdate(actor, entry),
  'You cannot update this entry'
)
```

### Policy Principles

- Never import Hono, Drizzle, or request context.
- Never mutate domain state.
- Policies explicitly decide unsupported actor types — e.g. API key actors may have narrower permissions than user actors.

---

## 9. Use Cases

### Entry Use Cases

**Explicit, separate use cases — avoid using `status: "published"` as the only publishing signal inside generic update flows.**

```
UpdateEntryUseCase      — update draft fields (title, slug, body)
PublishEntryUseCase     — publish an entry (explicit action)
UnpublishEntryUseCase   — un-publish an entry
DeleteEntryUseCase      — delete an entry
CreateEntryUseCase      — create a new entry
```

#### UpdateEntryUseCase

```ts
// application/entries/update-entry.usecase.ts
export class UpdateEntryUseCase {
  constructor(
    private entries: EntryRepository,
    private entryPolicy: EntryPolicy
  ) {}

  async execute(params: {
    actor: Actor
    entryId: string
    input: { title?: string; slug?: string; body?: unknown }
  }) {
    const entry = await this.entries.findById(params.entryId)
    if (!entry) throw new NotFoundError('Entry not found')

    await assertAllowed(
      this.entryPolicy.canUpdate(params.actor, entry),
      'You cannot update this entry'
    )

    entry.update(params.input)
    await this.entries.save(entry)
    return entry
  }
}
```

#### PublishEntryUseCase

```ts
// application/entries/publish-entry.usecase.ts
export class PublishEntryUseCase {
  constructor(
    private entries: EntryRepository,
    private entryPolicy: EntryPolicy
  ) {}

  async execute(params: { actor: Actor; entryId: string }) {
    const entry = await this.entries.findById(params.entryId)
    if (!entry) throw new NotFoundError('Entry not found')

    await assertAllowed(
      this.entryPolicy.canPublish(params.actor, entry),
      'You cannot publish this entry'
    )

    entry.publish()
    await this.entries.save(entry)
    return entry
  }
}
```

This pattern makes permission checks, audit logs, and lifecycle rules explicit per action rather than hidden inside a generic update flow.

### Media Use Cases

```
CreateMediaUploadUseCase        — create pending media + presigned upload URL
CompleteMediaUploadUseCase      — verify R2 object → mark uploaded → enqueue variants
RefreshMediaUploadUrlUseCase    — refresh expiring presigned URL
GenerateMediaVariantsUseCase    — read original → generate variants → store → mark ready
UpdateMediaMetadataUseCase      — update metadata fields
DeleteMediaUseCase              — soft-delete + remove R2 objects
ReprocessMediaUseCase           — re-trigger variant generation
PublishMediaUseCase             — set visibility to public
UnpublishMediaUseCase           — set visibility to private
```

---

## 10. Actor Model

```ts
// domain/authz/actor.ts
export type Actor =
  | { type: 'user'; id: string; sessionId?: string }
  | { type: 'api_key'; id: string; scopes: string[] }
  | { type: 'system'; id: 'queue' | 'cron' | 'migration' }
```

**Rules:**
- Do not fake queue or cron jobs as regular users — use system actors.
- Policies must explicitly handle unsupported actor types (e.g. system actors bypass authorization for internal operations).
- Use system actors for: `GenerateMediaVariantsUseCase`, scheduled cleanup, relationship repair jobs, media expiration cleanup.
- `Actor` is a first-class type from day one, defined in `domain/authz/` — not scattered across route handlers.

---

## 11. Hono Route Layer

### Entry Routes Example

```ts
// http/routes/entries.routes.ts
import { createRoute } from '@hono/zod-openapi'
import { createRequestContainer } from '../../composition/create-request-container'

const updateEntryRoute = createRoute({
  method: 'patch',
  path: '/entries/:entryId',
  request: {
    params: z.object({ entryId: idSchema }),
    body: {
      content: { 'application/json': { schema: updateEntryBodySchema } },
    },
  },
  responses: {
    200: { description: 'Entry updated', /* ... */ },
    401: { description: 'Unauthorized', /* ... */ },
    403: { description: 'Forbidden', /* ... */ },
    404: { description: 'Not found', /* ... */ },
  },
})

entriesRoutes.openapi(updateEntryRoute, async (c) => {
  const actor = c.get('actor')
  const { entryId } = c.req.valid('param')
  const input = c.req.valid('json')

  const container = createRequestContainer(c.env)
  const entry = await container.entries.update.execute({ actor, entryId, input })

  return presentEntry(entry)
})
```

**Route responsibilities:**
- Authenticate through middleware.
- Validate HTTP input via Zod schemas.
- Extract params.
- Call use case from the request container.
- Present (serialize) the response.
- Never: query Drizzle directly, check relationships, know role rules, or mutate entities.

---

## 12. Presenters

Do not expose domain entities or DB rows directly from routes.

```ts
// http/presenters/entry.presenter.ts
export function presentEntry(entry: Entry): z.infer<typeof entryResponseSchema> {
  return {
    id: entry.id,
    title: entry.title,
    slug: entry.slug,
    body: entry.body,
    status: entry.status,
    siteId: entry.siteId,
    collectionId: entry.collectionId,
    authorId: entry.authorId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    publishedAt: entry.publishedAt,
  }
}
```

```ts
// http/presenters/media.presenter.ts
export function presentMedia(media: Media): z.infer<typeof mediaResponseSchema> {
  return {
    id: media.id,
    filename: media.filename,
    contentType: media.contentType,
    size: media.size,
    status: media.status,
    variantUrls: media.variantUrls,
    createdAt: media.createdAt,
    updatedAt: media.updatedAt,
  }
}
```

---

## 13. Validation & Schema Strategy

### Source-of-Truth Hierarchy

```txt
Drizzle schema → generated Zod DB schemas (base material)
                → HTTP Zod schemas (public API contract)
                → Application command schemas (cross-boundary calls)
                → Domain entities enforce business invariants
                → DB constraints enforce persistence integrity
                → OpenAPI generated from HTTP schemas
```

### 1. Drizzle Schema Is Persistence Source Of Truth

```ts
export const media = sqliteTable('media', {
  id: text('id').primaryKey(),
  originalKey: text('original_key').notNull(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  status: text('status').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
```

### 2. Generated Zod DB Schemas Are Base Material — NOT Public API

```ts
export const mediaSelectDbSchema = createSelectSchema(media)
export const mediaInsertDbSchema = createInsertSchema(media)
```

These are building blocks. Never expose raw DB schemas as public request/response schemas, because DB rows contain internal fields (`original_key`, `created_by`, `deleted_at`, `etag`, etc.) that must not leak into the API or be accepted from clients.

### 3. HTTP Zod Schemas Are The Public API Contract

```ts
export const createMediaBodySchema = mediaInsertDbSchema
  .pick({ filename: true, contentType: true, size: true })
  .extend({
    filename: filenameSchema,
    contentType: imageContentTypeSchema,
    size: imageUploadSizeSchema,
  })

export const mediaResponseSchema = mediaSelectDbSchema
  .pick({ id: true, filename: true, contentType: true, size: true, status: true, createdAt: true, updatedAt: true })
  .extend({ variants: z.record(z.string()).optional() })
```

### 4. Reusable Field Schemas

```ts
// shared/validation/fields.ts
export const idSchema = z.string().min(1)
export const filenameSchema = z.string().min(1).max(255)
export const slugSchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
export const imageContentTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp'])
export const imageUploadSizeSchema = z.number().int().positive().max(MAX_IMAGE_UPLOAD_BYTES)
```

Avoid validation in comments — comments are not type-checked and can drift. Use explicit, imported Zod field schemas.

### 5. Application Command Schemas

For use cases that can be called from non-HTTP contexts (queues, cron, R2 event handlers):

```ts
export const createMediaUploadCommandSchema = z.object({
  actor: actorSchema,
  input: createMediaBodySchema,
})
```

Use command parsing where use cases cross process boundaries but not for every internal typed call.

### 6. Response Validation

Validate in dev/test; in production validate selectively or behind a feature flag:

```ts
export function makeJsonResponse<T extends z.ZodTypeAny>(
  c: Context, schema: T, data: unknown, status = 200
) {
  const shouldValidate =
    c.env.NODE_ENV !== 'production' || c.env.VALIDATE_RESPONSES === 'true'
  const body = shouldValidate ? schema.parse(data) : data
  return c.json(body, status)
}
```

### Validation Ownership Matrix

| Validation Type | Owner | Example |
|---|---|---|
| Request body shape | HTTP schema | `filename`, `contentType`, `size` |
| Route params | HTTP schema | `mediaId`, `entryId` |
| Query params | HTTP schema | `limit`, `cursor`, `status` |
| Response contract | HTTP schema + presenter | public media response |
| Use-case command shape | Application schema | `actor + input + mediaId` |
| Authorization | Policy | actor can update media |
| Business invariant | Domain entity/use case | cannot mark ready before processing |
| Persistence shape | Repository + DB schema | row has required fields |
| Uniqueness/integrity | DB constraint | unique slug, unique relationship |
| External verification | Use case/infrastructure | R2 object exists before ready |

### Anti-Patterns

- Using raw DB schema as public API schema.
- Returning DB rows directly from routes.
- Putting all business rules into Zod.
- Putting request validation in repositories.
- Maintaining OpenAPI separately from route schemas.
- Using magic comments as validation source.

---

## 14. Media Upload & Transformation Pipeline

### Final Flow

```txt
POST /media
  → create pending media + presigned upload URL

Client PUT original to R2 (directly, not through the Worker)

POST /media/:id/complete
  → verify original exists in R2
  → mark uploaded
  → enqueue GenerateMediaVariants
  → return processing status

Queue: GenerateMediaVariants
  → read original from R2
  → create thumb/small/medium/large/og/blur variants
  → store all variants in R2
  → mark ready

GET /media/:id
  → returns media + variant URLs + status

GET /media/:id/v/:version/variants/:name
  → serves R2 object with caching headers
```

### API Endpoints

```txt
POST   /media
GET    /media
GET    /media/:id
PATCH  /media/:id
DELETE /media/:id

POST   /media/:id/complete
POST   /media/:id/refresh-upload-url
POST   /media/:id/reprocess
POST   /media/:id/publish
POST   /media/:id/unpublish
GET    /media/:id/v/:version/variants/:name
```

### Upload Creation (`POST /media`)

Server responsibilities:
- Authenticate actor.
- Validate filename, content type, and declared size.
- Generate `mediaId`.
- Generate R2 object key (`media/{mediaId}/original`).
- Create media row with `pending_upload` status.
- Generate short-lived presigned PUT URL.
- Return media entity and upload instructions.

Response:

```json
{
  "media": {
    "id": "media_123",
    "filename": "hero.png",
    "contentType": "image/png",
    "size": 482331,
    "status": "pending_upload",
    "originalKey": "media/media_123/original"
  },
  "upload": {
    "method": "PUT",
    "url": "https://...",
    "expiresAt": "2026-05-17T10:15:00Z",
    "headers": { "Content-Type": "image/png" }
  }
}
```

Do not let the client choose the R2 key.

### Complete Upload (`POST /media/:id/complete`)

Server responsibilities:
- Load media row.
- Verify actor can manage the media entity.
- Check media is still `pending_upload` or `uploaded`.
- Use R2 binding to verify the original object exists.
- Optionally verify size, content type, checksum, or ETag.
- Mark media as `uploaded`.
- Enqueue `GenerateMediaVariants`.
- Return media with `processing` status.

The client does not set final status. The server verifies R2 before state changes.

### R2 Event-Notifications As Reliability Layer

```txt
R2 object-created event
  → Queue
  → Worker consumer
  → find media by originalKey
  → if pending_upload, mark uploaded
  → enqueue or run GenerateMediaVariants
```

Keep `/complete` as a fast client path. Make the event consumer idempotent. If both `/complete` and the R2 event arrive, only one should start processing.

### Media Statuses

```
pending_upload → processing → ready
pending_upload → expired
processing → failed
ready → deleted
```

### R2 Object Keys (Stable, Generated)

```txt
media/{mediaId}/original
media/{mediaId}/variants/thumb.webp
media/{mediaId}/variants/small.webp
media/{mediaId}/variants/medium.webp
media/{mediaId}/variants/large.webp
media/{mediaId}/variants/og.jpg
media/{mediaId}/variants/blur.webp
```

Store the user's original filename in the database, not in the object key.

### Default Variant Set (Fixed)

```ts
export const IMAGE_VARIANTS = {
  thumb:  { width: 160, height: 160, fit: 'cover', format: 'webp', quality: 75 },
  small:  { width: 480, fit: 'scale-down', format: 'webp', quality: 80 },
  medium: { width: 960, fit: 'scale-down', format: 'webp', quality: 82 },
  large:  { width: 1600, fit: 'scale-down', format: 'webp', quality: 85 },
  og:     { width: 1200, height: 630, fit: 'cover', format: 'jpg', quality: 85 },
  blur:   { width: 24, fit: 'scale-down', format: 'webp', quality: 35 },
} as const
```

Keep the variant list fixed — avoid arbitrary user-defined transforms unless there is a product need.

### Variant Generation Job (Idempotent)

```
GenerateMediaVariants:
  - Load media by ID
  - Check media is not deleted
  - If already processing/ready → no-op (idempotent guard)
  - Read original from R2
  - Generate missing variants only (skip existing)
  - Write variants to R2
  - Store variant metadata
  - Mark media ready when required variants exist
  - Mark media failed if processing fails after retries
```

### Transformation Engine

**Default:** Cloudflare Images binding as the transform engine, writing output back to R2.

Keep the transformer behind an interface so it can be swapped:

```ts
export interface ImageTransformer {
  transform(input: {
    body: ReadableStream
    variant: ImageVariantConfig
  }): Promise<{
    body: ReadableStream
    contentType: string
    width?: number
    height?: number
    format: string
    size?: number
  }>
}
```

Implementations: `CloudflareImagesTransformer` (default), `SharpImageTransformer` (external fallback).

### Infrastructure Interfaces

```ts
export interface ObjectStorage {
  get(key: string): Promise<ReadableStream | null>
  head(key: string): Promise<ObjectMetadata | null>
  put(key: string, body: BodyInit, options?: PutOptions): Promise<void>
  delete(key: string): Promise<void>
}

export interface ObjectStorageSigner {
  createPresignedPutUrl(input: {
    key: string
    contentType: string
    expiresInSeconds: number
  }): Promise<string>
}
```

Implementations:

```txt
R2ObjectStorage         → R2 binding
R2PresignedUrlSigner    → R2 S3-compatible credentials
```

### Cleanup

- **Abandoned uploads:** `pending_upload` where `upload_expires_at < now` → mark expired, delete original if it exists.
- **Failed processing:** after retries exhausted → mark failed, allow `POST /media/:id/reprocess`.
- **Deleted media:** soft-delete DB row, delete original and variants from R2.
- **Scheduled cleanup Worker:** handles expired pending uploads and orphaned objects.

### Security

- Never trust client-submitted final status.
- Do not let client choose object keys.
- Restrict allowed content types.
- Enforce max upload size before issuing upload URL.
- Use short-lived presigned PUT URLs.
- Verify object exists in R2 before marking uploaded.
- Optionally verify declared size and content type after upload.
- Originals are always private — only backend/system processing reads them.

---

## 15. Media Public/Private Visibility

### Visibility Model

```ts
type MediaVisibility = 'private' | 'public'
```

**Defaults:**
- Originals: always private.
- Variants: private by default, public only when explicitly published.
- Media visibility defaults to private.

**Status/visibility rules:**

| Status | Visibility | Access |
|--------|-----------|--------|
| pending_upload / processing / failed / expired / deleted | any | never public-readable |
| ready | private | authenticated read only |
| ready | public | anonymous variant read allowed |

### Explicit Publish/Unpublish Actions

Prefer explicit actions over silently changing visibility through generic metadata updates:

```txt
POST /media/:id/publish    — set visibility to public
POST /media/:id/unpublish  — set visibility to private
```

Metadata update (`PATCH /media/:id`) remains but public/private state changes are policy-guarded.

### Serving Variants

**Public ready variant:**

```txt
GET /media/:id/v/:version/variants/:name
→ Allow anonymous access
→ Serve from R2
→ Cache-Control: public, max-age=31536000, immutable
→ Content-Type: image/webp
→ ETag: <variant-etag>
```

**Private variant:**

```txt
→ Require authenticated actor
→ Check MediaPolicy.canRead
→ Serve through Worker
→ Cache-Control: private, max-age=60
```

If private media bandwidth becomes a problem, add short-lived presigned GET URLs.

### Versioned Media Variant URLs

URL includes version to prevent stale public caches:

```txt
GET /media/:id/v/:version/variants/:name
```

When media content changes or variants are regenerated, increment `media.version`. Old URLs expire naturally or can be purged.

---

## 16. Error Contract

All API errors use a single shape:

```json
{
  "error": {
    "code": "MEDIA_NOT_FOUND",
    "message": "Media not found",
    "requestId": "req_123",
    "details": {}
  }
}
```

Error-to-HTTP-status mapping:

```txt
ValidationError    → 400
UnauthorizedError  → 401
ForbiddenError     → 403
NotFoundError      → 404
ConflictError      → 409
RateLimitError     → 429
UnknownError       → 500
```

Implement in:

```txt
src/shared/errors.ts
src/http/middleware/error.middleware.ts
src/http/schemas/error.schema.ts
```

Every route reuses the same error schema in OpenAPI.

---

## 17. Idempotency

Critical endpoints require idempotency support:

```txt
POST /media
POST /media/:id/complete
POST /media/:id/reprocess
POST /entries/:id/publish
```

For create endpoints, support:

```txt
Idempotency-Key: <client-generated-key>
```

Idempotency table:

```sql
CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  route TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT,
  status INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
)
```

**Endpoint-specific rules:**

`POST /media/:id/complete`:

```
pending_upload → verify R2 → processing
processing     → return current media
ready          → return current media
expired/deleted → 409 Conflict
```

Queue jobs must also be idempotent.

---

## 18. Transaction & Partial-Write Policy

For each multi-write workflow, define behavior for partial failure scenarios:

| Workflow | DB succeeds, Queue fails | Queue succeeds, DB fails | R2 exists, DB missing | DB exists, R2 missing |
|---|---|---|---|---|
| Create entry + author relationship | Use transaction where available; compensating cleanup otherwise | Same | N/A | N/A |
| Create membership + relationship | Transaction or idempotent retry | Same | N/A | N/A |
| Create media pending + idempotency row | Keep pending; scheduled repair | Scheduled repair | Cleanup orphan | Mark expired |
| Complete media + enqueue processing | Media left in repairable state; scheduled repair re-enqueues | Scheduled repair | Cleanup orphan | Mark failed, allow reprocess |
| Delete media + delete variants | Delete variants on next cleanup pass | Retry variant deletion | Already consistent | Mark as soft-deleted, orphan cleanup |

**Principle:** Prefer repair over perfect atomicity where D1 transactions are not available.

---

## 19. Queue Messages

Queue messages are versioned, validated, and idempotent.

```ts
// application/events/media.events.ts
export type GenerateMediaVariantsJob = {
  type: 'media.generate_variants'
  version: 1
  mediaId: string
  originalKey: string
  requestedAt: string
  requestId?: string
}
```

**Rules:**
- Queue messages are versioned.
- Queue messages are validated with Zod.
- Consumers are idempotent (can safely retry).
- Dead-letter queues configured for failed media processing.
- Every message includes a request/correlation ID when available.

Implementation files:

```txt
src/application/events/media.events.ts
src/infrastructure/queues/queue-message.schema.ts
src/infrastructure/queues/media.consumer.ts
src/infrastructure/queues/generate-media-variants.producer.ts
```

---

## 20. Audit Logging

Audit sensitive mutations only — not every request.

**Events captured:**

```txt
entry published / unpublished / deleted
media deleted / reprocessed / made public/private
membership changed
API key created/rotated/revoked
relationship changed
```

Do not audit ordinary reads by default.

**Audit table:**

```sql
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  metadata_json TEXT,
  request_id TEXT,
  created_at INTEGER NOT NULL
)
```

**Rules:**
- Failed permission checks do not create success audit events.
- Audit writes are best-effort or failure behavior is explicit.
- Use `system` actor type for queued/cron/migration actions in audit logs.

---

## 21. Pagination, Filtering & Sorting

Use shared CRUD utilities — do not hand-roll list query behavior inside every route.

### Base Query Schema

```ts
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
})
```

Resource-specific schemas extend it:

```ts
export const listMediaQuerySchema = listQuerySchema.extend({
  status: mediaStatusSchema.optional(),
  contentType: z.string().optional(),
})
```

### Cursor Pagination (Default)

```txt
GET /media?limit=20&cursor=...
```

Response shape:

```json
{
  "data": [],
  "page": {
    "nextCursor": "..."
  }
}
```

Avoid mixing cursor, offset, page, and skip styles. Use cursor pagination by default.

### Implementation Structure

```txt
src/shared/pagination/
  pagination.schema.ts
  cursor.ts
  paginated-result.ts

src/application/crud/
  list-resource.usecase.ts
  crud-resource.config.ts
  crud-query.ts

src/infrastructure/persistence/
  crud-adapter.ts
  cursor-pagination.ts
  query-builder.ts
```

**Rules:**
- Routes validate query params via Zod.
- CRUD list use case validates/normalizes list commands.
- CRUD adapter applies allowed filters, sorts, and cursor pagination.
- Routes and repositories must not duplicate pagination logic.

---

## 22. Import Boundaries

Enforce with linting/tooling:

```txt
domain/** cannot import infrastructure/**
domain/** cannot import http/**
application/** cannot import http/**
http/** cannot import infrastructure/db/**
```

Possible tools: `eslint no-restricted-imports`, `eslint-plugin-boundaries`, `dependency-cruiser`.

---

## 23. Environment & Config Validation

Validate runtime configuration with Zod at startup:

```txt
src/config/env.ts
```

Validate:

```txt
NODE_ENV
VALIDATE_RESPONSES
MAX_IMAGE_UPLOAD_BYTES
UPLOAD_URL_TTL_SECONDS
R2 account ID, access key, secret key
R2 binding presence (object, not string)
Queue binding presence (object)
D1 binding presence (object)
```

Cloudflare bindings are objects, not strings — validate presence and expected shape carefully.

---

## 24. Testing Strategy

| Test Level | Target | Approach |
|---|---|---|
| Policy unit tests | EntryPolicy, MediaPolicy | Fake RelationshipRepository |
| Use case tests | All use cases | Fake repositories, storage, queues |
| Repository integration tests | Drizzle repositories | Local D1/Drizzle |
| HTTP tests | Hono routes | `app.request()` |
| Queue tests | Queue consumers | Fake queue message → consumer → assert DB/R2 effects |
| Contract tests | OpenAPI | Schema validation, OpenAPI generation |

**Minimum vertical slice tests:**

```txt
POST /media
POST /media/:id/complete
GenerateMediaVariants queue job
GET /media/:id
GET /media/:id/v/:version/variants/:name
PATCH /entries/:id
POST /entries/:id/publish
```

---

## 25. Persistence Model

### Persistence Choice

**Drizzle** is the default query layer for Cloudflare Workers/D1. Do not introduce Knex.

If an alternative is needed, **Kysely** with D1 dialect is acceptable but must remain hidden behind repository interfaces:

```txt
src/infrastructure/db/kysely.ts
src/infrastructure/db/database.types.ts
src/infrastructure/persistence/kysely-crud-adapter.ts
src/infrastructure/repositories/kysely-entry.repository.ts
```

Application and domain layers must not import Kysely or Drizzle directly.

### Core Tables

```sql
CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (site_id) REFERENCES sites(id)
);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  body_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER,
  FOREIGN KEY (site_id) REFERENCES sites(id),
  FOREIGN KEY (collection_id) REFERENCES collections(id)
);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  original_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  upload_expires_at INTEGER,
  uploaded_at INTEGER,
  processed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE media_variants (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  format TEXT NOT NULL,
  size INTEGER,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(media_id, name),
  FOREIGN KEY (media_id) REFERENCES media(id)
);

-- ReBAC relationships
CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX relationships_unique_idx
ON relationships (subject_type, subject_id, relation, object_type, object_id);

CREATE INDEX relationships_subject_idx ON relationships (subject_type, subject_id);
CREATE INDEX relationships_object_idx ON relationships (object_type, object_id);

-- Idempotency
CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  route TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT,
  status INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Audit
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  metadata_json TEXT,
  request_id TEXT,
  created_at INTEGER NOT NULL
);
```

**Important invariant:** Domain tables are the source of truth for resource state. The relationships table is the source of truth for authorization relationships. Do not duplicate every relationship as a role column unless needed for query performance.

---

## 26. Edge Cases & Failure Modes

### Missing Actor
→ `401 Unauthorized` handled by `auth.middleware.ts`

### Entry Does Not Exist
→ `404 Not Found`. Do not reveal whether a resource exists if the actor may not have access.

### Actor Has Site Access But Not Entry Access
→ `403 Forbidden`. Example: writer can access site but cannot update another writer's draft.

### Author Attempts To Update Published Entry
→ `403 Forbidden`. Author + draft = can update; author + published = cannot update unless editor/admin/owner.

### Relationship Drift
→ entry.authorId says `user:u1` but relationships table is missing `user:u1 author entry:e1`. Policy follows relationship table. Data repair job or migration should restore missing rows. When creating an entry, write the entry row and the author relationship in the same transactional unit if supported.

### Partial Writes
→ Entry created but author relationship write failed → entry should not be considered fully created. Use transactions where available; otherwise use compensating cleanup or idempotent retry.

### Duplicate Relationships
→ Prevented by `relationships_unique_idx`.

### API Key Actor
→ Policies must explicitly decide which actions API keys can perform (typically narrower than user actors).

### Admin Role Changes
→ If an owner removes an editor relation, subsequent checks fail immediately. Do not cache relationship checks across requests unless invalidation is designed.

### Queue Job Failures
→ Dead-letter queues configured. `GenerateMediaVariants` is idempotent and retry-safe.

### R2 Object Missing Despite DB Row
→ `POST /media/:id/complete` verifies R2 object existence before state change. If R2 object is missing → return 400.

### DB Row Missing Despite R2 Object
→ Orphan cleanup job removes objects with no corresponding media row.

### Both /complete and R2 Event Arrive
→ Both paths are idempotent: if already processing/ready → no-op. Only one starts processing.

---

## 27. Final Target Model

```
Repository Pattern  → controls persistence boundaries
ReBAC               → controls permission facts
Policy objects      → interpret ReBAC facts for domain resources
Use cases           → where repositories and policies meet
Hono routes         → only adapt HTTP to use cases
Presenters          → serialize domain objects for HTTP responses
Composition root    → wires everything per-request
```

### Hybrid Resource Strategy

```
~60% simple resources → generic CRUD route/config → shared CRUD adapter → repository
~40% domain workflows → explicit route → explicit use case → repository + policy → relationship repository
```

### Dependency Graph

```
http/routes
  → composition/create-request-container

composition/create-request-container
  → application/usecases
  → infrastructure/repositories

application/usecases
  → domain/repository interfaces
  → domain/policies

domain/policies
  → domain/authz/relationship.repository interface

infrastructure/repositories
  → implements domain/repository interfaces

infrastructure/db
  → Drizzle/D1
```

### Stable Request Flow (Entry Update)

```
http/routes/entries.routes.ts
  → composition/create-request-container.ts
    → application/entries/update-entry.usecase.ts
      → domain/entries/entry.repository.ts (load)
      → domain/entries/entry.policy.ts
        → domain/authz/relationship.repository.ts
      → domain/entries/entry.repository.ts (save)
  → http/presenters/entry.presenter.ts
```

---

## References

Source documents this file consolidates and supersedes:

1. `cms-api-repository-rebac-architecture.md` — core architecture with repository pattern, ReBAC, policies, use cases, folder structure
2. `immediate-changes.md` — architecture corrections: composition outside `application/`, request-scoped container, shared CRUD adapter, resource split, Drizzle preference, batched `hasAnyRelation`, explicit workflow use cases
3. `media-upload-transformation-process.md` — presigned R2 uploads, `/complete` flow, queue-driven variant generation, variant serving, cleanup
4. `validation-schema-strategy.md` — Zod layers (DB → HTTP → command), field schemas, presenters, OpenAPI, anti-patterns
5. `implementation-readiness-recommendations.md` — error contract, idempotency, transactions, queue contracts, system actor, audit, pagination, import boundaries, testing, env validation
