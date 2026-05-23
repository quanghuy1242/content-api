# Migrate Content API From Auther To `id`

> Status: implementation-grade proposal
>
> Date: 2026-05-22
>
> Scope:
>
> - `/home/quanghuy1242/pjs/content-api` — replace Auther-specific resource-token verification with `id` resource-server verification.
> - `/home/quanghuy1242/pjs/auth` — prerequisite token issuer/resource-server configuration only; object authorization remains outside `id`.
>
> Source docs:
>
> - `src/application/auth/authenticate-bearer-token.usecase.ts`
> - `src/domain/authz/actor.ts`
> - `src/config/env.ts`
> - `src/composition/create-request-container.ts`
> - `src/http/middleware/auth.middleware.ts`
> - `src/http/routes/helpers.ts`
> - `src/infrastructure/db/schema.ts`
> - `wrangler.jsonc`
> - `wrangler.test.jsonc`
> - `/home/quanghuy1242/pjs/auth/docs/005_oauth2-oidc-integration-guide.md`
> - `/home/quanghuy1242/pjs/auth/docs/006_resource-server-jwt-guide.md`
> - `/home/quanghuy1242/pjs/auth/docs/008_legacy-auth-flow-analysis.md`
> - `/home/quanghuy1242/pjs/auth/docs/010_organization-teams-oauth-flow.md`
> - `/home/quanghuy1242/pjs/auth/packages/lib/src/resource-token-verifier.ts`
>
> Related docs:
>
> - `docs/007_content-iam-policy-binding-model.md`
> - `docs/architecture.md`
> - `docs/payloadcms-access-control-policy-spec.md`

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 Current Content API Verification](#31-current-content-api-verification)
  - [3.2 Current Environment Contract](#32-current-environment-contract)
  - [3.3 Current User Mapping](#33-current-user-mapping)
  - [3.4 Current `id` Resource-Server Contract](#34-current-id-resource-server-contract)
  - [3.5 Current Tests](#35-current-tests)
- [4. Target Model](#4-target-model)
  - [4.1 Token Verification](#41-token-verification)
  - [4.2 Actor Mapping](#42-actor-mapping)
  - [4.3 Scope Boundary](#43-scope-boundary)
  - [4.4 Relationship To Content IAM](#44-relationship-to-content-iam)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 Implement Migration Separately From Content IAM](#51-implement-migration-separately-from-content-iam)
  - [5.2 Keep `id` Generic And Better Auth-Aligned](#52-keep-id-generic-and-better-auth-aligned)
  - [5.3 Use Coarse Scopes For The Migration](#53-use-coarse-scopes-for-the-migration)
  - [5.4 Do Not Query `id` During Resource Authorization](#54-do-not-query-id-during-resource-authorization)
- [6. Implementation Strategy](#6-implementation-strategy)
- [7. Detailed Implementation Plan](#7-detailed-implementation-plan)
  - [7.1 Environment And Resource Server Registration](#71-environment-and-resource-server-registration)
  - [7.2 Token Verifier](#72-token-verifier)
  - [7.3 Actor Contract](#73-actor-contract)
  - [7.4 Tests](#74-tests)
  - [7.5 Documentation And Cleanup](#75-documentation-and-cleanup)
- [8. Migration And Rollout](#8-migration-and-rollout)
- [9. Edge Cases And Failure Modes](#9-edge-cases-and-failure-modes)
- [10. Implementation Backlog](#10-implementation-backlog)
  - [M1-A. Register And Configure `id` Resource Server](#m1-a-register-and-configure-id-resource-server)
  - [M1-B. Replace Auther Token Checks](#m1-b-replace-auther-token-checks)
  - [M1-C. Update Test Fixtures](#m1-c-update-test-fixtures)
  - [M1-D. Prepare Actor Shape For Content IAM](#m1-d-prepare-actor-shape-for-content-iam)
- [11. Future Backlog](#11-future-backlog)
- [12. Definition Of Done](#12-definition-of-done)
- [13. Final Model](#13-final-model)

## 1. Goal

Replace Auther-specific access-token verification in `content-api` with `id` resource-server verification.

This document is intentionally narrow. It handles issuer/JWKS/audience/scope migration and prepares the actor contract for teams and service accounts. It does not design book/chapter sharing, group grants, or object authorization. Those belong to [docs/007_content-iam-policy-binding-model.md](docs/007_content-iam-policy-binding-model.md).

Non-goals:

- Do not migrate content object authorization into `id`.
- Do not build a policy-query service.
- Do not keep Auther grant mirrors as the final model.
- Do not solve book/chapter/team sharing in this migration batch.

Recommended sequencing:

1. Land this migration first so `content-api` trusts `id` tokens.
2. Then implement Content IAM on top of the new token/actor contract.

The two workstreams may live in one implementation branch if necessary, but they should be reviewed as separate behavior changes.

## 2. System Summary

Current:

```text
auther
  issues JWT:
    iss = https://auth.quanghuy.dev
    aud = payload-content-api
    token_use = access

content-api
  verifies Auther JWKS
  requires token_use=access
  maps sub -> users.better_auth_user_id
  derives admin from JWT roles or local users.role
```

Target:

```text
id
  issues resource-bound JWT only when OAuth token request includes:
    resource = https://content-api.quanghuy.dev

  JWT:
    iss = https://id.quanghuy.dev/api/auth
    aud = https://content-api.quanghuy.dev
    scope = content:read content:write content:share
    org_id = active organization when org-scoped
    sub = user id for user tokens
    team_ids = active-org team ids once id teams are enabled
    azp/client_id = OAuth client for M2M tokens

content-api
  verifies id JWKS
  requires configured coarse scope
  builds Actor from sub or client id plus org/team claims
  leaves object authorization to local policies/use cases
```

## 3. Current-State Findings

### 3.1 Current Content API Verification

`src/application/auth/authenticate-bearer-token.usecase.ts` currently:

1. Extracts `Bearer <token>`.
2. Verifies with `jwtVerify(token, createRemoteJWKSet(jwksUrl), { issuer, audience })`.
3. Requires `token_use === "access"`.
4. Requires `sub`.
5. Looks up a local user by `users.findByBetterAuthUserId(sub)`.
6. Derives `role` from JWT `roles` or local `users.role`.
7. Returns `UserActor`.

The `token_use` and `roles` claims are Auther-era assumptions. `id` access tokens do not require `token_use`, and role claims should not control content authorization.

### 3.2 Current Environment Contract

`wrangler.jsonc` currently uses:

```jsonc
"AUTH_ISSUER": "https://auth.quanghuy.dev",
"AUTH_AUDIENCE": "payload-content-api",
"AUTH_JWKS_URL": "https://auth.quanghuy.dev/api/auth/jwks"
```

The target `id` values are:

```jsonc
"AUTH_ISSUER": "https://id.quanghuy.dev/api/auth",
"AUTH_AUDIENCE": "https://content-api.quanghuy.dev",
"AUTH_JWKS_URL": "https://id.quanghuy.dev/api/auth/jwks"
```

Add a required-scope setting so deployments can change the coarse API gate without code edits:

```jsonc
"AUTH_REQUIRED_SCOPE": "content:read"
```

### 3.3 Current User Mapping

The D1 schema has:

```ts
users.id
users.betterAuthUserId
posts.author -> users.id
categories.createdBy -> users.id
media.owner -> users.id
```

For the migration batch, keep this mapping to minimize blast radius. The Content IAM work should later decide whether to:

- keep `users.id` as content-local profile ID and rename `better_auth_user_id` to `identity_subject`; or
- make `users.id` equal `id` `sub` before real data exists.

The second option is simpler long term, but it changes more code and should be handled with Content IAM/user projection cleanup.

### 3.4 Current `id` Resource-Server Contract

`/home/quanghuy1242/pjs/auth/packages/lib/src/resource-token-verifier.ts` validates:

- JWT signature through JWKS;
- issuer;
- audience;
- required scopes;
- optional `org_id`;
- `sub` for user tokens.

It does not currently support custom fetch injection for tests. `content-api` tests already inject `fetchImpl` to serve fixture JWKS, so either `@id/lib` needs a `fetchImpl` option or `content-api` needs a local wrapper around `jose`.

The live discovery metadata checked on 2026-05-22 advertises:

- issuer: `https://id.quanghuy.dev/api/auth`
- JWKS: `https://id.quanghuy.dev/api/auth/jwks`
- authorization endpoint: `https://id.quanghuy.dev/api/auth/oauth2/authorize`
- token endpoint: `https://id.quanghuy.dev/api/auth/oauth2/token`
- scopes including `api:read` and `api:write`
- end-session endpoint for RP-initiated logout

The planned `id` contract in `/home/quanghuy1242/pjs/auth/docs/010_organization-teams-oauth-flow.md` now names this as an OAuth scope catalog problem, not an authorization-policy problem:

- resource-server-bound product/API scopes live in `oauthResourceScope`;
- optional org-scoped M2M eligibility lives in `oauthClientOrganizationGrant`;
- product roles, role-permission mappings, object bindings, resource hierarchy, and final policy decisions stay in resource APIs such as `content-api`.

### 3.5 Current Tests

Tests in `tests/api.test.ts` issue fixture JWTs with:

- legacy issuer/audience;
- `token_use: "access"`;
- optional `roles`;
- fixture JWKS served through `createApp({ fetchImpl })`.

Those fixtures must switch to:

- `iss = https://id.test/api/auth`;
- `aud = https://content-api.test`;
- `scope = content:read`;
- no `token_use`;
- no role-derived admin behavior from JWT.

## 4. Target Model

### 4.1 Token Verification

`AuthenticateBearerTokenUseCase` should validate:

```text
signature
issuer
audience
expiration
subject for user tokens
required scope
optional org_id when a route/resource requires org scope
```

It must not validate:

```text
token_use
Auther roles
Auther grant claims
content object grants
```

### 4.2 Actor Mapping

The immediate migration can keep `UserActor`, but the target actor should be compatible with Content IAM:

```ts
type UserActor = {
  type: "user";
  subject: string;
  id: string;
  localUserId?: string;
  organizationId?: string;
  teamIds: string[];
  scopes: string[];
  email?: string;
};

type ServiceAccountActor = {
  type: "service_account";
  clientId: string;
  organizationId?: string;
  scopes: string[];
};
```

The first implementation may preserve the existing `Actor` shape and add fields in a compatibility-safe way. Content IAM should finish the actor cleanup.

### 4.3 Scope Boundary

Scopes are coarse API gates. Configure the Content API resource server with:

```text
content:read
content:write
content:share
```

Do not encode `book.update`, `chapter.publish`, `media.attach`, or other Content IAM permissions as OAuth scopes. Object authorization and role composition belong to Content IAM.

### 4.4 Relationship To Content IAM

This migration makes `content-api` trust `id` for identity facts:

```text
who: sub or client_id
where: org_id
teams: team_ids
coarse capability: scope
```

Content IAM will then decide:

```text
Can this user/team/service account perform this content permission on this concrete resource?
```

## 5. Architecture Decisions

### 5.1 Implement Migration Separately From Content IAM

Recommended: migrate token verification first, then implement Content IAM.

Rationale:

- Token migration is small and testable.
- Content IAM changes domain policies, routes, migrations, and book model assumptions.
- A split keeps authn failures distinct from authz model changes.

### 5.2 Keep `id` Generic And Better Auth-Aligned

`id` should act like Better Auth/Auth0-style infrastructure:

- identity;
- sessions;
- teams;
- OAuth clients;
- resource servers;
- token claims;
- JWKS.

`id` should not own content object grants or `ContentPolicy.can(...)`.

### 5.3 Use Coarse Scopes For The Migration

Use one required read scope for the initial verifier. Add per-route write scopes later when Content IAM work changes route policies.

Rejected for this batch:

- One OAuth scope per content permission.
- One OAuth scope per book/chapter.
- Runtime policy calls to `id`.

### 5.4 Do Not Query `id` During Resource Authorization

`content-api` should not call `id` for every request. It verifies the JWT locally, then uses local state for object authorization.

This avoids recreating the old Auther live-check/mirror problem.

## 6. Implementation Strategy

The migration should be implemented in phases:

1. Configure `id` resource-server audience for `content-api`.
2. Update `content-api` env schema and Worker vars.
3. Replace Auther-only JWT checks.
4. Update tests and fixture tokens.
5. Keep existing routes/policies operational.
6. Prepare actor fields for Content IAM without switching object authorization yet.

## 7. Detailed Implementation Plan

### 7.1 Environment And Resource Server Registration

Current problem:

- `content-api` trusts `auth.quanghuy.dev` and `payload-content-api`.
- OAuth scope names such as `api:read` are too generic if `id` allows globally-scoped product permissions.

Target behavior:

- `content-api` trusts `id.quanghuy.dev` and a URL audience.
- `id` issues `content:read`/`content:write`/`content:share` only as resource-server-scoped permissions for the Content API audience.

Implementation tasks:

- [ ] Create or verify an `id` resource server:

```json
{
  "organizationId": "org_1",
  "slug": "content-api",
  "name": "Content API",
  "audience": "https://content-api.quanghuy.dev"
}
```

- [ ] Make `content:read`, `content:write`, and `content:share` resource-server-bound in `id` through `oauthResourceScope`. `resourceServerId` should be required rather than optional so the scope names cannot collide across products.
- [ ] Update `wrangler.jsonc` and `wrangler.test.jsonc`.
- [ ] Add `AUTH_REQUIRED_SCOPE` to `src/config/env.ts`.
- [ ] Update README local setup auth config.

Tests:

- `pnpm typecheck`
- env parsing tests if present
- `pnpm test`

### 7.2 Token Verifier

Current problem:

- The verifier rejects `id` tokens because they lack `token_use=access`.

Target behavior:

- The verifier accepts valid `id` resource-bound tokens and rejects missing/invalid scopes.

Implementation tasks:

- [ ] Remove `token_use` validation.
- [ ] Remove JWT role-derived admin logic.
- [ ] Parse scope claim into `scopes`.
- [ ] Catch verifier errors and convert them to `UnauthorizedError`.
- [ ] Decide whether to depend on `@id/lib` or keep a local wrapper:
  - prefer `@id/lib` if it supports `fetchImpl`;
  - otherwise use a local `jose` wrapper and track the `@id/lib` enhancement.

Tests:

- Missing token returns `401`.
- Invalid signature returns `401`.
- Wrong issuer returns `401`.
- Wrong audience returns `401`.
- Missing required scope returns `401` or `403` according to final error contract.
- Valid `id` token authenticates.

### 7.3 Actor Contract

Current problem:

- `Actor` is user-only for current routes and carries Auther-era `externalId`/`localUserId` assumptions.

Target behavior:

- Existing routes keep working.
- Actor can later carry `organizationId`, `scopes`, `teamIds`, and service-account identity.

Implementation tasks:

- [ ] Add non-breaking actor fields if useful:

```ts
organizationId?: string;
teamIds?: string[];
scopes?: string[];
```

- [ ] Keep `localUserId` until local user identity cleanup is planned.
- [ ] Do not treat M2M as admin by default.
- [ ] For M2M tokens, either reject in this migration or create a `ServiceAccountActor` with explicit scopes.

Tests:

- User token still reaches protected routes.
- M2M behavior is explicit: accepted as service account or rejected until Content IAM supports it.

### 7.4 Tests

Current problem:

- Fixtures issue Auther-shaped tokens.

Target behavior:

- Fixtures issue `id`-shaped tokens.

Implementation tasks:

- [ ] Update test constants:

```ts
const AUTH_ISSUER = "https://id.test/api/auth";
const AUTH_AUDIENCE = "https://content-api.test";
const AUTH_JWKS_URL = "https://id.test/api/auth/jwks";
const AUTH_REQUIRED_SCOPE = "content:read";
```

- [ ] Remove `token_use` from `issueToken`.
- [ ] Add `scope`.
- [ ] Add tests for missing scope and wrong audience.
- [ ] Stop using JWT `roles` to create admin actors.

Tests:

- `pnpm test`

### 7.5 Documentation And Cleanup

Implementation tasks:

- [ ] Update README auth section.
- [ ] Mark this planning document implemented when complete.
- [ ] Ensure README planning/status list includes this document.
- [ ] Remove Auther wording from comments once the migration lands.

## 8. Migration And Rollout

Recommended deployment order:

1. Ensure `id` production resource server exists for `https://content-api.quanghuy.dev`.
2. Ensure the OAuth client that calls `content-api` sends `resource=https://content-api.quanghuy.dev`.
3. Deploy code that accepts `id` tokens.
4. Deploy Worker vars pointing at `id`.
5. Smoke with a real `id` token.

Rollback:

- Revert Worker vars and code together if token validation fails.
- Do not run a mixed issuer mode unless there is a specific compatibility requirement. Auther and `id` have different issuers/JWKS URLs, so env selection is the clean switch.

## 9. Edge Cases And Failure Modes

| Scenario | Expected behavior |
|---|---|
| Token missing `scope` | Reject. `id` must issue requested scopes. |
| Token has wrong audience | Reject. The client likely omitted `resource` or used the wrong resource server. |
| Token has no `org_id` | Accept only for non-org-scoped routes. Content IAM should reject org resources without matching `org_id`. |
| User token has no local user row | For current create workflows, either create/project local user or fail with linked-user error. Content IAM should resolve this explicitly. |
| M2M token has no `sub` | Do not map to user. Create service-account actor or reject until supported. |
| Org-scoped M2M token has no `org_id` | Reject for org resources. Service accounts are not global admins by default. |
| Team membership changes | Old tokens may carry old `team_ids` until expiry. Content IAM should account for that risk or use introspection for high-risk routes later. |
| User belongs to too many teams for token size | `id` should fail token issuance for that org instead of silently truncating `team_ids`. If this becomes common, move to a deliberate membership projection design. |
| `@id/lib` cannot inject test fetch | Use local wrapper or update `@id/lib`; keep tests deterministic. |

## 10. Implementation Backlog

### M1-A. Register And Configure `id` Resource Server

Scope:

- `wrangler.jsonc`
- `wrangler.test.jsonc`
- `src/config/env.ts`
- `README.md`

Tasks:

- [ ] Register `https://content-api.quanghuy.dev` in `id`.
- [ ] Add `AUTH_REQUIRED_SCOPE`.
- [ ] Update Worker vars and test vars.

Acceptance criteria:

- Env parsing accepts the new config.
- README documents `id` issuer/audience/JWKS.

Tests:

- `pnpm typecheck`

### M1-B. Replace Auther Token Checks

Scope:

- `src/application/auth/authenticate-bearer-token.usecase.ts`
- optional verifier helper under `src/application/auth/`

Tasks:

- [ ] Remove `token_use`.
- [ ] Validate issuer/audience/scope.
- [ ] Parse optional `org_id` and `team_ids`.
- [ ] Remove JWT role-derived admin behavior.

Acceptance criteria:

- Valid `id` token authenticates.
- Auther-only token format is not required.

Tests:

- `pnpm test`

### M1-C. Update Test Fixtures

Scope:

- `tests/api.test.ts`
- `wrangler.test.jsonc`

Tasks:

- [ ] Issue `id`-shaped fixture tokens.
- [ ] Update mocked JWKS URL.
- [ ] Add missing-scope test.

Acceptance criteria:

- Existing API tests pass with new token format.

Tests:

- `pnpm test`

### M1-D. Prepare Actor Shape For Content IAM

Scope:

- `src/domain/authz/actor.ts`
- `src/application/auth/authenticate-bearer-token.usecase.ts`

Tasks:

- [ ] Add `scopes`, `organizationId`, and `teamIds` to user actor if safe.
- [ ] Define explicit service-account behavior.
- [ ] Avoid treating M2M as admin.

Acceptance criteria:

- Content IAM can build on the actor without another auth migration.

Tests:

- `pnpm typecheck`
- `pnpm test`

## 11. Future Backlog

- Rename `better_auth_user_id` to provider-neutral `identity_subject`, or make `users.id` equal `id` `sub`.
- Add per-route required scope checks after Content IAM lands.
- Add optional token introspection for high-risk administrative operations.
- Remove Auther grant/deferred/relationship tables when Content IAM replaces them.

## 12. Definition Of Done

- `content-api` verifies `id`-issued resource-bound JWTs.
- `token_use` is no longer required.
- Required scopes are enforced.
- Env vars point to `https://id.quanghuy.dev/api/auth` and `https://content-api.quanghuy.dev`.
- Tests issue `id`-shaped tokens.
- README auth setup and planning list are updated.
- `pnpm lint`, `pnpm check:dup`, `pnpm typecheck`, and `pnpm test` pass after implementation.

## 13. Final Model

```text
content-ui / service client
  requests resource-bound token from id
  sends Authorization: Bearer <JWT>

content-api
  verifies id issuer/JWKS/audience/scope
  builds actor from token claims
  delegates object authorization to local policies and future Content IAM
```
