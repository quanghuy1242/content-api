# Content API

Cloudflare Workers content API built with Hono, D1, and Drizzle. This repo implements the initial documented scope:

- `users`
- `categories`
- `posts`
- `media` direct-to-R2 uploads, processor-generated variants, and API-served variant streaming
- `books` as the first collaborative product and Content IAM resource boundary
- Content IAM permission/role/binding/denial/audit administration
- legacy Auther grant mirror, deferred grant, relationship tables, and admin routes removed; product ownership uses row ownership or Content IAM

## Contracts

This implementation follows the contracts in:

- [docs/architecture.md](docs/architecture.md)
- [docs/payloadcms-schema-spec.md](docs/payloadcms-schema-spec.md)
- [docs/payloadcms-access-control-policy-spec.md](docs/payloadcms-access-control-policy-spec.md)
- `~/pjs/auth` (`id`) OAuth2 resource-server token behavior

Architecture planning documents and implementation status:

> **Latest status (2026-05-25):** docs 001–011 are implemented in production. **docs/012 (Content Lifecycle Plugin) is the next implementation up.** docs/013 (Site Config Collection) depends on 012 and follows immediately. docs/014–017 are the post-lifecycle batch (book content model + interactions + EPUB import) and depend on 012. docs/009 is abandoned; its remaining scope lives in 015/016/017.


- [docs/001_idempotency-batch-design.md](docs/001_idempotency-batch-design.md) — implemented
- [docs/002_media-upload-flow.md](docs/002_media-upload-flow.md) — implemented
- [docs/003_entity-classes-and-oxlint-arch-linting.md](docs/003_entity-classes-and-oxlint-arch-linting.md) — implemented
- [docs/004_code-duplication-and-abstraction-linting.md](docs/004_code-duplication-and-abstraction-linting.md) — implemented
- [docs/005_publish-lifecycle-adapter.md](docs/005_publish-lifecycle-adapter.md) — superseded by docs/012
- [docs/006_migrate-auther-to-id.md](docs/006_migrate-auther-to-id.md) — implemented
- [docs/007_content-iam-policy-binding-model.md](docs/007_content-iam-policy-binding-model.md) — IAM substrate, book product root, and legacy authz cleanup implemented; descendant hierarchy in progress
- [docs/008_review-last-commit-006-007.md](docs/008_review-last-commit-006-007.md) — review addressed
- [docs/009_book-resource-hierarchy-and-collaboration-plan.md](docs/009_book-resource-hierarchy-and-collaboration-plan.md) — **abandoned**; remaining work absorbed into docs/015, docs/016, docs/017 (BKH-A book root shipped and remains in production)
- [docs/010_batch-2-review-006-007.md](docs/010_batch-2-review-006-007.md) — remediation verified
- [docs/011_post-006-007-gap-fixes.md](docs/011_post-006-007-gap-fixes.md) — gap fixes
- [docs/012_content-lifecycle-plugin.md](docs/012_content-lifecycle-plugin.md) — implementation-grade proposal: pluggable lifecycle plugin (`draft`/`scheduled`/`published`/`archived`) with generic use cases, per-resource adapters, compare-and-set publish, hourly Cloudflare Cron Trigger, dedicated `*.archive` permissions, status removed from generic PATCH; supersedes docs/005; covers Post, Book, SiteConfig, future Chapter
- [docs/013_site-config-collection.md](docs/013_site-config-collection.md) — implementation-grade proposal: promotable SiteConfig collection with Zod-validated dynamic blocks, lifecycle-plugin adoption from day one, partial-unique single-published invariant, and formal rationale for categories as org-owned resources (depends on docs/012)
- [docs/014_audit-service-stub.md](docs/014_audit-service-stub.md) — stub: placeholder noting that only `content_policy_events` exists (binding-scoped); names candidate triggers from docs/015/016/017 and defers general resource audit design
- [docs/015_book-content-model.md](docs/015_book-content-model.md) — implementation-grade proposal: recursive `chapters` table (configurable max depth, default 4), Lexical content schema (block IDs, `chapter-link`/`broken-link`/`image` nodes), `media_attachments` table + `media.attach` permission, `book.origin = imported|platform` with auto-promotion on first edit, and `POST /books/{id}:replace` destructive workflow (depends on docs/012)
- [docs/016_book-interactions.md](docs/016_book-interactions.md) — implementation-grade proposal: comments + inline comments as IAM-tracked resources with public-vs-moderation policy split, rate limits, edit window, block-orphaning behavior; bookmarks + reading progress as user-private subject-scoped tables not routed through `ContentPolicy.can` (depends on docs/015)
- [docs/017_epub-import.md](docs/017_epub-import.md) — implementation-grade proposal: browser uploads `.epub` to R2 via presigned URL, R2 event-driven queue, new `workers/epub-processor/` Worker, streaming ZIP+OPF parse with Range reads + `DecompressionStream`, two-pass walk producing recursive chapters + import-time `chapter-link` resolution + reuse of the existing media pipeline; `book_imports` table + `book.import` permission; wires `POST /books/{id}:replace` to the same pipeline (depends on docs/015)

Auth is implemented as an OAuth2 resource server:

- bearer JWTs are validated against `id` JWKS with `jose`
- `iss` must match `AUTH_ISSUER`
- `aud` must match `AUTH_AUDIENCE`
- `scope` must include at least one accepted Content API scope from `AUTH_REQUIRED_SCOPE`; use cases enforce route-level `content:read`, `content:write`, or `content:share`
- user actors use `sub` directly as `users.id`; content-api fills new local profile/authorship projections from available `id` token facts without erasing stored fields when optional profile claims are absent
- direct-share user tokens have no `org_id`, no team authority, and cannot carry `content:share`
- M2M tokens authenticate as service-account actors through `azp`/`client_id`, without implicit admin authority
- Content IAM durable policy writes validate target users, teams, and service accounts through `id` principal-validation endpoints using an auto-refreshed client-credentials M2M token; hot-path object checks stay local
- Content IAM protects sensitive delegation, custom-role tenant isolation, optimistic role updates, disabled-role binding lifecycle, first-admin bootstrap, last-admin revocation, and bounded denied-mutation audit storage through policy and D1 write guards
- Book product routes require local `org.create_book`, atomically create one direct owner binding, support explicit-owner service-account imports, and gate private reads/updates through Content IAM

## Stack

- `hono@4.12.19`
- `drizzle-orm@0.45.2`
- `drizzle-kit@0.31.10`
- `wrangler@4.92.0`
- `jose@6.2.3`
- `vitest@4.1.6`

Versions were verified on May 17, 2026.

## Architecture Notes

- Hono routes validate HTTP input, call the request-scoped container, and present domain objects.
- `src/application/**` owns explicit use cases; `src/domain/**` owns entities, repository contracts, and policy checks.
- `src/infrastructure/persistence/crud-adapter.ts` owns shared CRUD row access, cursor pagination, filters, and sort plumbing for simple resources.
- `src/infrastructure/repositories/mappers/**` owns DB row ↔ domain entity conversion; repositories should not inline `mapX` or persistence payload builders.
- Every implemented collection follows the documented resource name, for example `domain/posts`, `application/posts`, and `http/routes/posts.routes.ts`.

## Local Setup

1. Install dependencies:

```bash
pnpm install
```

2. Create remote resources (one-time):

```bash
# D1 database
wrangler d1 create content_api
# → copy the returned UUID into wrangler.jsonc database_id

# R2 bucket
wrangler r2 bucket create content-api-media

# Queue for media processing events
wrangler queues create media-processing

# R2 event notification → queue
wrangler r2 bucket notification create content-api-media \
  --event-type object-create \
  --queue media-processing \
  --prefix "media/" \
  --suffix "/original"
```

3. Keep non-secret Worker vars in `wrangler.jsonc`. Secret bindings used by local `wrangler dev` belong in `.dev.vars` so they do not collide with CI-managed Cloudflare secrets:

```jsonc
{
  "vars": {
    "AUTH_ISSUER": "https://id.quanghuy.dev/api/auth",
    "AUTH_AUDIENCE": "https://content-api.quanghuy.dev",
    "AUTH_JWKS_URL": "https://id.quanghuy.dev/api/auth/jwks",
    "AUTH_REQUIRED_SCOPE": "content:read content:write content:share",
    "ID_PRINCIPAL_VALIDATION_URL": "https://id.quanghuy.dev",
    "ID_PRINCIPAL_VALIDATION_AUDIENCE": "https://id.quanghuy.dev/principal-validation",
    "ID_PRINCIPAL_VALIDATION_SCOPE": "identity:principals:validate",
    "R2_BUCKET_NAME": "content-api-media",
    "MAX_IMAGE_UPLOAD_BYTES": "10485760",
    "UPLOAD_URL_TTL_SECONDS": "300"
  }
}
```

Create `.dev.vars` from the committed example:

```bash
cp .dev.vars.example .dev.vars
```

Set `ID_PRINCIPAL_VALIDATION_CLIENT_ID` and `ID_PRINCIPAL_VALIDATION_CLIENT_SECRET` in `.dev.vars` or as Cloudflare secrets. The Worker exchanges them at `ID_PRINCIPAL_VALIDATION_TOKEN_URL` when configured, or at `/api/auth/oauth2/token` under `ID_PRINCIPAL_VALIDATION_URL`, for a principal-validation audience token with `identity:principals:validate`.

4. Apply local migrations:

```bash
pnpm db:migrate:local
```

5. Start local development:

```bash
pnpm dev
```

Media processing is deployed as a separate Worker under [workers/media-processor](workers/media-processor). Its `wrangler.jsonc` shares the same D1, R2, Images, and Queue bindings as the API Worker.

Tests use [wrangler.test.jsonc](wrangler.test.jsonc), which keeps committed mock signer credentials for the Vitest worker pool without duplicating production secret bindings in the deploy config.

## Migrations

Schema lives in [src/infrastructure/db/schema.ts](src/infrastructure/db/schema.ts). Generated SQL migrations live under [drizzle](drizzle).

Generate a new migration:

```bash
pnpm db:generate
```

Apply to remote D1:

```bash
pnpm db:migrate:remote
```

## Quality Checks

```bash
pnpm lint
pnpm check:dup
pnpm typecheck
pnpm test
pnpm check
pnpm advise
```

`pnpm check` is the hard gate: oxlint architecture rules, the wrapper-enforced Fallow mild duplicate threshold, TypeScript, and Vitest. `pnpm advise` is non-blocking review input from Aislop plus conservative semantic Fallow duplication; run it after substantial code changes and use judgment on context-dependent findings.

Current automated coverage includes:

- `401` unauthenticated
- `401` invalid token, wrong audience, no accepted content scope, and invalid direct-share `content:share`
- per-route OAuth gates for read, write, and Content IAM share mutations
- `403` forbidden
- `404` missing resource
- media upload lifecycle, idempotent create replay, and queue ack/retry behavior
- happy paths across posts, media, users, books, and Content IAM resources
- `id`-shaped user, direct-share, and service-account token fixtures
- Content IAM bootstrap races, last-admin races, binding idempotency/concurrency, protected delegation, tenant-isolated roles, effective binding views, bounded denial auditing, ownership-transfer concurrency, M2M principal-validation fetch/cache, and denial-precedence coverage
- Book root creation, atomic owner binding, idempotent create replay/concurrency, direct-share root rejection, M2M explicit-owner import, private reads/updates, and public published reads

## Deployment

CI/CD is handled by [.github/workflows/ci-deploy.yml](.github/workflows/ci-deploy.yml). On every push to `main` (or manual dispatch), a single GitHub Actions job runs this pipeline in order:

1. `pnpm check` — lint, duplicate gate, typecheck, tests
2. `wrangler d1 migrations apply content_api --remote`
3. Deploy the API Worker (`content-api`)
4. Deploy the queue consumer (`content-api-media-processor`)

Required GitHub secrets:

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with Workers and D1:Edit permissions
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID
- `R2_ACCOUNT_ID` — Cloudflare account ID exposed to the Worker for presigned upload signing
- `R2_ACCESS_KEY_ID` — R2 access key for presigned upload URLs
- `R2_SECRET_ACCESS_KEY` — R2 secret key for presigned upload URLs
- `ID_PRINCIPAL_VALIDATION_CLIENT_ID` — `id` OAuth client used only for principal-validation M2M calls
- `ID_PRINCIPAL_VALIDATION_CLIENT_SECRET` — secret for the principal-validation OAuth client

## Not Implemented

Intentionally excluded from this repo:

- frontend/admin UI
- undocumented endpoints
