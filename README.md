# Content API

Cloudflare Workers content API built with Hono, D1, and Drizzle. This repo implements the initial documented scope:

- `users`
- `categories`
- `posts`
- `media` direct-to-R2 uploads, processor-generated variants, and API-served variant streaming
- `grant-mirror`
- `deferred-grants`
- `relationships` for ReBAC-style authorization facts

## Contracts

This implementation follows the contracts in:

- [docs/architecture.md](docs/architecture.md)
- [docs/payloadcms-schema-spec.md](docs/payloadcms-schema-spec.md)
- [docs/payloadcms-access-control-policy-spec.md](docs/payloadcms-access-control-policy-spec.md)
- `~/pjs/auther` resource-token/JWKS behavior

Architecture planning documents and implementation status:

- [docs/001_idempotency-batch-design.md](docs/001_idempotency-batch-design.md) — implemented
- [docs/002_media-upload-flow.md](docs/002_media-upload-flow.md) — implemented
- [docs/003_entity-classes-and-oxlint-arch-linting.md](docs/003_entity-classes-and-oxlint-arch-linting.md) — implemented
- [docs/004_code-duplication-and-abstraction-linting.md](docs/004_code-duplication-and-abstraction-linting.md) — implemented

Auth is implemented as an OAuth2 resource server:

- bearer JWTs are validated against Auther JWKS
- `iss` must match `AUTH_ISSUER`
- `aud` must match `AUTH_AUDIENCE`
- `token_use` must be `access`
- authenticated actors are attached to Hono context and mapped to local users through `betterAuthUserId`

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

3. Set Worker vars in `wrangler.jsonc` (non-secret values):

```jsonc
{
  "vars": {
    "AUTH_ISSUER": "https://auth.quanghuy.dev",
    "AUTH_AUDIENCE": "payload-content-api",
    "AUTH_JWKS_URL": "https://auth.quanghuy.dev/api/auth/jwks",
    "R2_BUCKET_NAME": "content-api-media",
    "MAX_IMAGE_UPLOAD_BYTES": "10485760",
    "UPLOAD_URL_TTL_SECONDS": "300"
  }
}
```

4. Create `.dev.vars` for local secrets (gitignored):

```bash
# .dev.vars (local only — overridden by CI secrets in production)
R2_ACCOUNT_ID=local-account
R2_ACCESS_KEY_ID=local-access-key
R2_SECRET_ACCESS_KEY=local-secret-key
```

5. Apply local migrations:

```bash
pnpm db:migrate:local
```

6. Start local development:

```bash
pnpm dev
```

Media processing is deployed as a separate Worker under [workers/media-processor](workers/media-processor). Its `wrangler.jsonc` shares the same D1, R2, Images, and Queue bindings as the API Worker.

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
- `401` invalid token
- `403` forbidden
- `404` missing resource
- media upload lifecycle, idempotent create replay, and queue ack/retry behavior
- happy paths across posts, media, users, and authz-admin resources

## Deployment

CI/CD is handled by [.github/workflows/ci-deploy.yml](.github/workflows/ci-deploy.yml). On every push to `main` (or manual dispatch):

1. `pnpm check` — lint, duplicate gate, typecheck, tests
2. `migrate` — `wrangler d1 migrations apply content_api --remote`
3. `deploy-api` — deploys the API Worker (`content-api`)
4. `deploy-media-processor` — deploys the queue consumer (`content-api-media-processor`)

Both deploy jobs run in parallel after migrations succeed.

Required GitHub secrets:

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with Workers and D1:Edit permissions
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID
- `R2_ACCESS_KEY_ID` — R2 access key for presigned upload URLs
- `R2_SECRET_ACCESS_KEY` — R2 secret key for presigned upload URLs

## Not Implemented

Intentionally excluded from this repo:

- frontend/admin UI
- undocumented endpoints
