# Content API

Cloudflare Workers content API built with Hono, D1, and Drizzle. This repo implements the initial documented scope:

- `users`
- `categories`
- `posts`
- `media` metadata only
- `grant-mirror`
- `deferred-grants`
- `relationships` for ReBAC-style authorization facts

## Contracts

This implementation follows the contracts in:

- [docs/architecture.md](docs/architecture.md)
- [docs/payloadcms-schema-spec.md](docs/payloadcms-schema-spec.md)
- [docs/payloadcms-access-control-policy-spec.md](docs/payloadcms-access-control-policy-spec.md)
- `~/pjs/auther` resource-token/JWKS behavior

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

2. Create a D1 database and replace the placeholder `database_id` in [wrangler.jsonc](wrangler.jsonc).

3. Set Worker vars in `wrangler.jsonc` or your Cloudflare environment:

```jsonc
{
  "vars": {
    "AUTH_ISSUER": "https://auth.example.com",
    "AUTH_AUDIENCE": "payload-content-api",
    "AUTH_JWKS_URL": "https://auth.example.com/api/auth/jwks"
  }
}
```

4. Apply local migrations:

```bash
pnpm db:migrate:local
```

5. Start local development:

```bash
pnpm dev
```

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
pnpm typecheck
pnpm test
```

Current automated coverage includes:

- `401` unauthenticated
- `401` invalid token
- `403` forbidden
- `404` missing resource
- happy paths across posts, media, users, and authz-admin resources

## Deployment

Deployment automation is currently disabled. The workflow has been moved to
[.github/workflows-disabled/deploy.yml](.github/workflows-disabled/deploy.yml)
so GitHub Actions will not execute it.

When re-enabled by moving it back to `.github/workflows/deploy.yml`, the workflow runs:

1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`
3. `pnpm test`
4. remote D1 migrations
5. `wrangler deploy`

Required GitHub secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Before first deploy, update:

- `wrangler.jsonc` D1 `database_id`
- production `AUTH_ISSUER`
- production `AUTH_AUDIENCE`
- production `AUTH_JWKS_URL`

## Not Implemented

Intentionally excluded from this repo:

- media upload
- image processing
- background jobs
- frontend/admin UI
- undocumented endpoints
