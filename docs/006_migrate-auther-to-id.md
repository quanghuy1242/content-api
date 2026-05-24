# Migrate Content API From Auther To `id`

> Status: implemented
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
>
> Implementation notes:
>
> - Implemented in `content-api` with a local `jose` verifier so tests can inject fixture JWKS fetches.
> - Worker env now targets `https://id.quanghuy.dev/api/auth` and the public Content API audience.
> - Local user identity uses `users.id = id.sub`; `better_auth_user_id` is removed by the generated `0003_content_iam_policy` migration.
> - Local projection synchronization treats absent optional `email`, `name`, and `picture` claims as not supplied, so narrow content tokens do not erase existing profile fields.
> - Vitest fixtures now issue `id`-shaped user, direct-share, and M2M tokens.

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
  - [M1-D. Finalize Actor And Local User Identity](#m1-d-finalize-actor-and-local-user-identity)
- [11. Future Backlog](#11-future-backlog)
- [12. Definition Of Done](#12-definition-of-done)
- [13. Final Model](#13-final-model)

## 1. Goal

Replace Auther-specific access-token verification in `content-api` with `id` resource-server verification.

This document is intentionally narrow. It handles issuer/JWKS/audience/scope migration, changes local user identity to use `id` `sub` directly, and supports user and service-account access-token actors, including direct-share user tokens that do not carry organization/team authority. It does not design book/chapter sharing, group grants, or object authorization. Those belong to [docs/007_content-iam-policy-binding-model.md](docs/007_content-iam-policy-binding-model.md).

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
  uses sub directly as users.id for user actors
  accepts direct-share user tokens without org_id/team authority for later direct resource bindings
  builds service-account Actor from client id for M2M tokens
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

Decision for this migration:

- keep a local `users` table for content-owned profile/authorship fields and existing FK targets;
- make `users.id` equal the stable `id` `sub`;
- remove `users.better_auth_user_id` rather than carrying a second identity key into the new system;
- store user principals in future Content IAM bindings using the same `sub`/`users.id` value.

There is no production data, so this is the clean point to remove the extra identifier mapping. Authentication can build the user actor directly from `sub`; use cases that require a local user/profile row should create or require that row using `id = sub`.

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
- org-scoped M2M eligibility lives in `oauthClientOrganizationGrant` and must be ready before M2M-backed content access is deployed;
- workspace and direct-share user token contexts are selected explicitly at authorization/consent time rather than inferred after an authorization failure;
- direct-share user tokens must contain `sub`, no `org_id`, and `team_ids = []`, may request `content:read` and/or `content:write`, and must never receive `content:share`;
- refresh/new issuance must preserve the selected direct-share context; an `id`-internal consent/reference marker used to keep that context distinct must never be emitted as token `org_id`;
- `id` issues a direct-share token without consulting Content IAM bindings; the resource API decides whether an existing direct ordinary binding permits the requested resource operation;
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

The migration actor contract should be compatible with Content IAM:

```ts
type UserActor = {
  type: "user";
  subject: string;
  id: string;
  organizationId?: string;
  teamIds: string[];
  scopes: string[];
  email?: string;
};

type ServiceAccountActor = {
  type: "service_account";
  clientId: string;
  organizationId: string;
  scopes: string[];
};
```

For user actors, `id` and `subject` are the same `id` `sub` value. A user actor with no `organizationId` represents direct-share identity only: later Content IAM may evaluate direct ordinary user bindings, but it must not evaluate team/org authority or permit policy mutation. For service-account actors, `clientId` is taken from the documented `azp` or `client_id` M2M claim. M2M support is part of this migration target, not deferred; service accounts are never treated as administrators without later local Content IAM bindings.

### 4.3 Scope Boundary

Scopes are coarse API gates. Configure the Content API resource server with:

```text
content:read
content:write
content:share
```

Do not encode `book.update`, `chapter.publish`, `media.attach`, or other Content IAM permissions as OAuth scopes. Object authorization and role composition belong to Content IAM.

Token contexts are explicit:

| User token context | Claims | Scopes available to the Content API | Authorization purpose |
|---|---|---|---|
| Workspace | `sub`, `org_id`, `team_ids` restricted to that organization | `content:read`, `content:write`, `content:share` as allowed for the OAuth client | May use local user/team policy and, with local authority, attempt Content IAM mutations. |
| Direct share | `sub`, no `org_id`, `team_ids = []` | `content:read`, `content:write` only | May use an existing direct ordinary `user:sub` binding after a concrete resource is loaded. |

The absence of `org_id` identifies direct-share context. An empty `team_ids` claim alone does not: a workspace user can legitimately have no teams in the selected organization.

A direct-share actor with `content:write` and a suitable ordinary binding may update a shared book/chapter or create ordinary descendants such as chapters, sections, comments, inline comments, or attached media in that already-shared subtree. It cannot create a new organization-root book, receive organization/team-derived authority, or mutate Content IAM state.

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
- `id.resourceServer.organizationId` identifies administration of the OAuth audience/scope registration only; token `org_id` supplies workspace authority context and the loaded content row `org_id` remains the content tenant boundary.

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
- [ ] Accept user tokens with `sub` and M2M tokens with stable `azp`/`client_id` rather than requiring `sub` for every authenticated request.
- [ ] Accept direct-share user tokens only with no `org_id`, `team_ids = []`, and no `content:share`; they may carry `content:read` and/or `content:write`.
- [ ] Reject mismatched non-empty organization context rather than downgrading a workspace token to direct-share mode.
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
- Valid direct-share user token without `org_id`, with `team_ids = []`, and with `content:read` or `content:write` authenticates with no team authority.
- Direct-share user token requesting or carrying `content:share` is rejected.
- Refreshed direct-share user token remains direct-share and never exposes an internal context marker as `org_id`.
- Workspace token carrying a non-matching `org_id` is rejected rather than retried as direct-share.
- Valid `id` M2M token authenticates as a service-account actor.

### 7.3 Actor Contract

Current problem:

- `Actor` is user-only for current routes and carries Auther-era `externalId`/`localUserId` assumptions.

Target behavior:

- User actors use `sub` directly as `id`, aligned with `users.id`.
- Service-account actors are accepted from valid M2M tokens.
- Actor carries `organizationId`, `scopes`, `teamIds`, or service-account identity as appropriate.

Implementation tasks:

- [ ] Replace user identity mapping with `id = subject = payload.sub`.
- [ ] Add user actor fields:

```ts
organizationId?: string;
teamIds?: string[];
scopes?: string[];
```

- [ ] Change the local `users` persistence contract so `users.id` stores `id` `sub`, preserving local user rows as FK/profile records.
- [ ] Remove `better_auth_user_id` and its lookup repository path.
- [ ] Do not treat M2M as admin by default.
- [ ] Parse valid M2M tokens into a `ServiceAccountActor` using stable `azp`/`client_id`.
- [ ] Require `org_id` on M2M requests to organization-owned resources.
- [ ] Preserve `organizationId` as optional for user direct-share identity and require matching organization context for later IAM mutations, top-level organization book creation, or team-derived authority.

Tests:

- User token creates an actor whose ID equals its `sub`.
- Local authored-resource FKs use the same user ID.
- Valid M2M token creates a service-account actor.
- Org-scoped M2M requests without `org_id` are rejected.
- User token without `org_id` can represent direct-share identity only and cannot gain team/org policy authority.

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
- [ ] Add M2M fixture tokens using `azp`/`client_id` and `org_id`.
- [ ] Add direct-share user fixture tokens with no `org_id`, `team_ids = []`, and `content:read` or `content:write`; add an invalid `content:share` direct-share fixture.
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
3. Ensure `id` exposes explicit workspace/direct-share token selection, preserves direct-share context across refresh without emitting an internal context marker as `org_id`, excludes `content:share` from direct-share tokens, and exposes the M2M claim and `oauthClientOrganizationGrant` contract before enabling Content IAM sharing or service-account content access.
4. Deploy code that accepts `id` user and M2M tokens.
5. Deploy Worker vars pointing at `id`.
6. Smoke with real user and M2M `id` tokens.

Rollback:

- Revert Worker vars and code together if token validation fails.
- Do not run a mixed issuer mode unless there is a specific compatibility requirement. Auther and `id` have different issuers/JWKS URLs, so env selection is the clean switch.

## 9. Edge Cases And Failure Modes

| Scenario | Expected behavior |
|---|---|
| Token missing `scope` | Reject. `id` must issue requested scopes. |
| Token has wrong audience | Reject. The client likely omitted `resource` or used the wrong resource server. |
| User token has no `org_id` and has `team_ids = []` | Accept as direct-share identity only. Later Content IAM may use a direct ordinary `user:sub` binding on a loaded resource, including locally authorized ordinary descendant work, but must not use team/org authority, create an organization-root book, or permit IAM mutation. |
| Direct-share user token carries `content:share` | Reject. `content:share` is workspace-only because it gates security-state mutation attempts. |
| User token has an `org_id` different from loaded resource org | Reject; do not downgrade a mismatched workspace token to direct-share access. |
| User token has no local user row | Authentication still produces `id = sub`; operations requiring a local authorship/profile row create or require `users.id = sub`. |
| M2M token has no `sub` | Expected. Resolve stable `azp`/`client_id` and create a service-account actor. |
| Org-scoped M2M token has no `org_id` | Reject for org resources. Service accounts are not global admins by default. |
| Team membership changes | Old user tokens may carry old `team_ids` for at most the agreed 15-minute lifetime; refresh/new issuance reflects current membership. Sensitive Content IAM mutations are direct-user-only in v1. |
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
- [ ] Parse `sub`, optional `team_ids`, `org_id`, and M2M `azp`/`client_id` according to token type.
- [ ] Accept M2M tokens without `sub` as service-account actors.
- [ ] Treat a user token without `org_id` and with `team_ids = []` as direct-share identity only; permit `content:read`/`content:write` coarse capabilities but reject `content:share`.
- [ ] Remove JWT role-derived admin behavior.

Acceptance criteria:

- Valid `id` token authenticates.
- Valid direct-share user token authenticates without organization/team authority and may carry `content:write` for later ordinary descendant policy decisions.
- Direct-share token with `content:share` is rejected.
- Valid `id` M2M token authenticates as a service-account actor.
- Auther-only token format is not required.

Tests:

- `pnpm test`

### M1-C. Update Test Fixtures

Scope:

- `tests/api.test.ts`
- `wrangler.test.jsonc`

Tasks:

- [ ] Issue `id`-shaped fixture tokens.
- [ ] Issue M2M-shaped fixture tokens using `azp`/`client_id` and `org_id`.
- [ ] Issue direct-share user fixture tokens without `org_id`, with `team_ids = []`, and with read/write scope variants.
- [ ] Issue an invalid direct-share fixture carrying `content:share`.
- [ ] Update mocked JWKS URL.
- [ ] Add missing-scope test.

Acceptance criteria:

- Existing API tests pass with new token format.

Tests:

- `pnpm test`

### M1-D. Finalize Actor And Local User Identity

Scope:

- `src/domain/authz/actor.ts`
- `src/application/auth/authenticate-bearer-token.usecase.ts`
- `src/domain/users/`
- `src/infrastructure/db/schema.ts`
- `src/infrastructure/repositories/`
- `drizzle`

Tasks:

- [ ] Use `sub` directly for user actor ID and `users.id`.
- [ ] Remove `better_auth_user_id` schema/repository mapping.
- [ ] Add `scopes`, `organizationId`, and `teamIds` to user actor.
- [ ] Keep user `organizationId` optional so direct ordinary resource sharing does not require organization membership.
- [ ] Accept M2M tokens as service-account actors using `azp`/`client_id`.
- [ ] Require `org_id` for service-account access to organization-owned resources.
- [ ] Avoid treating M2M as admin.

Acceptance criteria:

- Content IAM can use user principal IDs without provider-ID projection.
- Service accounts can participate in later Content IAM bindings without another authentication migration.
- Direct external users can participate in later ordinary resource bindings, including allowed descendant work within an existing shared subtree, without being made organization members.

Tests:

- `pnpm typecheck`
- `pnpm test`

## 11. Future Backlog

- Add per-route required scope checks after Content IAM lands.
- Add optional token introspection for high-risk administrative operations.
- Remove Auther grant/deferred/relationship tables when Content IAM replaces them.

## 12. Definition Of Done

- `content-api` verifies `id`-issued resource-bound JWTs.
- `token_use` is no longer required.
- Required scopes are enforced.
- Local user records use `users.id = id.sub`; `better_auth_user_id` is removed.
- Valid M2M tokens produce service-account actors and are not granted implicit administrator authority.
- User tokens in direct-share context contain no `org_id`, have `team_ids = []`, carry only `content:read` and/or `content:write`, and produce actors without team/org policy authority.
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
  builds user actor with users.id = sub
  permits org-less direct-share user identity for direct ordinary resource bindings and locally authorized descendant work, but never policy mutation
  builds service-account actor from azp/client_id for M2M tokens
  delegates object authorization to local policies and future Content IAM
```
