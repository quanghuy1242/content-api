# Review Of Last Commit Implementing Docs 006 And 007

> Status: review complete
>
> Date: 2026-05-24
>
> Commit reviewed: `a11ab79d973b66960c0313e4adc068cd9b1f521a`
>
> Scope:
>
> - `docs/006_migrate-auther-to-id.md`
> - `docs/007_content-iam-policy-binding-model.md`
> - `/home/quanghuy1242/pjs/auth/docs/010_organization-teams-oauth-flow.md`
> - The implementation added or changed by the last commit.
>
> Review constraint: documentation-only review. No implementation fixes were made.

## Summary

The commit passes the current automated gates, but it should not be treated as a complete or contract-safe implementation of docs 006 and 007.

Commands run:

```bash
corepack pnpm check
corepack pnpm advise
```

Results:

- `pnpm check` passed: oxlint, duplicate gate, typecheck, and 40 Vitest tests.
- `pnpm advise` passed after existing suppressions: `all findings suppressed (29 aislop, 11 fallow)`.

The biggest issues are not lint/type failures. They are contract drift, missing deployment wiring, unsafe bootstrap semantics, insufficient local user identity migration, incomplete resource model coverage, and test gaps that let those problems pass.

## P0 Findings

### P0-1. Principal validation uses a static bearer token instead of the documented M2M contract

Evidence:

- `src/config/env.ts` requires `ID_PRINCIPAL_VALIDATION_URL` and `ID_PRINCIPAL_VALIDATION_TOKEN`.
- `src/infrastructure/identity/id-content-principal-directory.ts` sends `authorization: Bearer ${this.config.token}` directly.
- `/home/quanghuy1242/pjs/auth/docs/010_organization-teams-oauth-flow.md` says principal-validation calls require a dedicated M2M audience and `identity:principals:validate` scope.
- `/home/quanghuy1242/pjs/auth/workers/core/src/auth/plugins/principal-validation/operations.ts` verifies a JWT signature, issuer, audience, and scope.

Impact:

The content API is not implementing the `id` contract. A static `ID_PRINCIPAL_VALIDATION_TOKEN` is not a durable solution for an M2M access token, because `id` M2M tokens expire. If this value is an opaque shared secret, `id` will reject it. If this value is a manually pasted M2M JWT, it expires and policy writes fail later.

Expected direction:

Use M2M client credentials or a small token-provider port. The content API should configure client credentials plus the principal-validation audience/scope, fetch/cache an M2M token, and send that JWT to `id`. The env names should make that obvious.

### P0-2. CI/CD does not deploy the new required principal-validation secret

Evidence:

- `.github/workflows/ci-deploy.yml` was not changed in the commit.
- The API deploy action only passes `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_ACCOUNT_ID`.
- `README.md` does not list `ID_PRINCIPAL_VALIDATION_TOKEN` under required GitHub secrets.
- `src/main.ts` constructs the request container for every route before route handling, and `createRequestContainer` calls `parseEnv`.

Impact:

If the Cloudflare Worker does not already have this new secret out of band, every request that builds the container will fail env validation, including unrelated routes. This is a deployment breaker hidden by local tests.

Expected direction:

Update CI/CD secret wiring or replace this static token design with M2M credential secrets. Add a deploy-time or smoke-test check for the real principal-validation integration.

### P0-3. Local user identity is not actually migrated to `users.id = id.sub`

Evidence:

- Docs 006 says local user records use `users.id = id.sub`.
- `AuthenticateBearerTokenUseCase` builds user actors with `id = subject = payload.sub`.
- `User.create` still generates a random UUID for `users.id`.
- `userCreateSchema` does not accept an `id` or `sub`.
- `CreateUserUseCase` calls `User.create(input)` and therefore cannot create a local row whose ID equals the `id` subject.

Impact:

The repository removed `better_auth_user_id`, but the API still has no supported path to create a local user row keyed by the `id` subject. New real `id` users cannot reliably become local users through the public user API. Resource creation paths use actor IDs as FK values, so unprojected users can fail at persistence time or behave inconsistently.

Expected direction:

Define the local projection workflow explicitly. Either self-provision `users.id = actor.subject`, let admins create a user projection for a specific `id.sub`, or separate profile creation from identity projection.

### P0-4. Organization Content IAM bootstrap bypasses local Content IAM after the first admin exists

Evidence:

- `BootstrapOrganizationContentAdminUseCase` only checks that the caller is the target user and has `content:share`.
- It calls `validateOrganizationAdministrator`, then creates `system:org.content_admin`.
- It does not check whether an active local org content admin already exists.
- It does not require `actor.organizationId === orgId`.
- Docs 007 says bootstrap is for first admin or explicitly audited recovery, and ordinary delegation should be controlled locally.

Impact:

Any Better Auth organization owner/admin can repeatedly mint local `org.content_admin` for themselves, even after content-api local administration has already been established. That collapses the intended boundary: `id` should prove identity facts, while content-api should own product IAM after bootstrap.

Expected direction:

Bootstrap should be allowed only when there is no active local org admin, or through a clearly separate recovery workflow with stricter checks and audit semantics. It should also require a matching workspace token context.

### P0-5. Content IAM idempotency is not scoped to path parameters

Evidence:

- `executeIdempotentContentIamMutation` hashes only `params.input`.
- Route constants use templates such as `POST /books/{bookId}/policy-bindings`.
- Create binding, denial, ownership transfer, create role, replace role permissions, and admin delegation pass only body input to the idempotency hash.

Impact:

The same actor can reuse one idempotency key across different books, orgs, or role IDs with the same request body and receive a replay from the wrong resource operation. This is especially dangerous for policy writes and ownership transfer.

Expected direction:

Include the concrete resource identity and relevant path params in the idempotency request hash, or scope the idempotency route value to the concrete path.

## P1 Findings

### P1-1. Docs 007 is marked implemented, but the book/chapter/section/comment/bookmark product model is not implemented

Evidence:

- Docs 007 top status is `implemented`.
- The implementation only exposes organization and book policy-management routes.
- There are no `src/application/books`, `src/domain/chapters`, `src/domain/sections`, or product routes for chapters, sections, blocks, comments, bookmarks, reading progress, or recommendations.
- The docs 007 backlog still has unchecked IAM-G tasks for book/chapter resource models.
- `BookRepository.create` exists but no book create use case or HTTP route is wired.

Impact:

The status overstates the implementation. The commit builds an IAM administration substrate for org/book policy rows, not the full book collaboration system described by the doc. This creates planning risk because downstream work may assume hierarchy, descendant policy checks, and content operations exist.

Expected direction:

Either change docs 007 status to a partial implementation and explicitly defer the book/chapter/section/comment/bookmark system to the next numbered plan, or implement the missing resource model before calling 007 implemented.

### P1-2. Coarse OAuth scopes are enforced inconsistently

Evidence:

- Auth globally requires only `AUTH_REQUIRED_SCOPE`, configured as `content:read`.
- Existing write routes for posts, categories, media, and users do not require `content:write`.
- Content IAM management use cases check `content:share` manually, but route docs in 007 describe coarse per-route scope requirements.
- Docs say direct-share tokens may carry `content:read` and/or `content:write`; the current verifier rejects a write-only token because it lacks `content:read`.

Impact:

A token with only `content:read` can still reach old write use cases if local policy allows it. A valid write-only token shape described by the docs is rejected. This makes the OAuth scope model unreliable as a coarse capability gate.

Expected direction:

Define route/use-case scope requirements in code: read routes require read, write routes require write, Content IAM mutations require share. Do not use one global read gate for every authenticated operation once write/share behavior is in scope.

### P1-3. Sensitive direct-user targets are not always validated as organization members

Evidence:

- Docs 010 says `book.owner`, `book.sharing_manager`, and local `org.content_admin` user targets require user existence plus current membership in the resource organization.
- Book binding creation validates direct user targets with `validateUser` for book resources, including `book.sharing_manager`.
- Ownership transfer validates the next owner with `validateUser`, not `validateUserInOrganization`.

Impact:

An external direct user can receive policy-management authority or book ownership without being a current member of the resource organization, contrary to the principal-validation matrix.

Expected direction:

Use delegation class and role identity to select validation strength. Ordinary external user sharing can use `validateUser`; sensitive direct-user targets must use `validateUserInOrganization`.

### P1-4. Last organization Content IAM admin can be revoked

Evidence:

- `RevokePolicyBindingUseCase` only special-cases `system:book.owner`.
- It does not prevent revoking the last `system:org.content_admin` binding.
- Docs 007 lists this as an expected failure mode: last org content admin revoke should be rejected unless an atomic replacement is installed.

Impact:

An org can lose all local Content IAM administrators. The unsafe bootstrap behavior then becomes the only recovery path, further weakening the intended local IAM boundary.

Expected direction:

Add a dedicated admin revoke/recovery workflow with a last-admin invariant. Do not let generic binding revoke delete the final local org admin.

### P1-5. `org.author` cannot be assigned even though docs describe it as a built-in role

Evidence:

- `system:org.author` contains `org.create_book`.
- `org.create_book` is classified as `organization_admin`.
- Generic binding creation rejects `organization_admin` delegation class roles and says sensitive roles require a dedicated workflow.
- There is no dedicated workflow for `org.author`, and there is no book create route using `org.create_book`.

Impact:

The role catalog includes a built-in role that cannot be used through the public API. Book creation authority is therefore unclear: either everyone with org admin creates books, or no delegated author workflow exists.

Expected direction:

Decide whether `org.author` is a sensitive role with a dedicated workflow, an ordinary assignable role, or deferred until book creation lands. Then align permissions, docs, and routes.

### P1-6. The principal-validation target resource is hard-coded to production

Evidence:

- `CreatePolicyBindingUseCase` and `CreatePolicyDenialUseCase` call `validateServiceAccountForOrganization` with `resource: "https://content-api.quanghuy.dev"`.
- `AUTH_AUDIENCE` already exists and differs in tests.

Impact:

Staging, local, preview, and renamed deployments will validate service-account targets against the production Content API audience. That is a contract and environment bug.

Expected direction:

Pass the configured content API audience into the use cases through a domain/application-safe config value or a dedicated port.

### P1-7. Expired bindings and denials cannot be recreated cleanly

Evidence:

- `content_policy_bindings_unique_idx` does not account for expiration.
- `content_policy_denials_unique_idx` does not account for expiration.
- Create workflows insert new rows without deleting/replacing expired rows.
- Docs 007 explicitly calls out binding expiration and re-grant behavior.

Impact:

Once a binding or denial expires, the unique index can still block re-creating the same grant/denial. This contradicts the active-state model and creates operational cleanup requirements that are not implemented.

Expected direction:

Either make expiration cleanup part of authorized create workflows or model active rows so expired rows do not block re-granting.

## P2 Findings

### P2-1. Architecture smell: application helpers are placed beside use cases

Evidence:

`src/application/content-iam/` contains non-use-case helpers:

- `audit-denied-mutation.ts`
- `content-iam-snapshot.ts`
- `idempotent-content-iam.ts`
- `resource-loader.ts`

Impact:

This weakens the repository convention that application folders contain explicit use cases. It also explains why oxlint did not catch the smell: the current architecture rules check layer imports and route/repository boundaries, but not application file naming or helper placement.

Expected direction:

Move reusable application services behind explicit names and boundaries, or add an architecture lint rule if this convention is intended to be hard.

### P2-2. `ContentPolicy.canMany` is not batched

Evidence:

- Docs 007 calls for batch authorization for list endpoints.
- `LocalContentPolicy.canMany` loops over resources and calls `can` for each one.

Impact:

Large list endpoints will become N+1 policy query paths when the book/chapter resources are added.

Expected direction:

Implement real batched denial/allow lookups before exposing large private book/chapter/media lists.

### P2-3. Future hierarchy lookup can match wrong type/id pairs

Evidence:

- Binding and denial repository `resourceConditions` use `resource_type IN (...) AND resource_id IN (...)` for inherited resources.

Impact:

Once resources have multiple ancestors, this can match cross-paired rows if IDs collide across resource types, for example `org:<bookId>` or `book:<orgId>`. Current book/org-only usage is less exposed, but the code is already shaped as a generic hierarchy evaluator.

Expected direction:

Build OR conditions per `(resourceType, resourceId, direct/inherited)` pair rather than using independent `IN` lists.

### P2-4. Built-in permission and role seeding is not convergent

Evidence:

- `ensureSystemCatalog` inserts permissions and built-in roles with `onConflictDoNothing`.
- Built-in role-permission inserts also use conflict-do-nothing and never remove old rows.

Impact:

Future code-owned changes to permission descriptions, delegation classes, built-in role metadata, or built-in role permission composition will not reliably update existing databases.

Expected direction:

Use deterministic upsert/sync semantics for code-owned catalog rows, including removing stale built-in role-permission rows when the code definition changes.

### P2-5. Repository list methods omit org scoping

Evidence:

- Policy binding, denial, and event `findMany` methods filter by resource type/id or target type/id but not `org_id`.

Impact:

If IDs are globally unique this is harmless, but the IAM model is explicitly org-scoped. Queries should preserve that boundary instead of relying on ID uniqueness assumptions.

Expected direction:

Pass `orgId` into list repository methods and include it in predicates.

## Test Coverage Gaps

The test suite is useful, but it is not enough for this feature. The `id` project has many focused contract tests; this implementation mostly adds a few broad API-path tests and one small domain test.

Missing or insufficient coverage:

- Real principal-validation caller contract: no test proves content-api obtains and sends a valid M2M JWT with the principal-validation audience and `identity:principals:validate` scope.
- CI/deploy configuration: no test or workflow check proves all required env/secrets are present after deploy.
- User identity migration: no test creates a local user through the API and proves `users.id = id.sub`; no test covers an unprojected `id` user trying FK-backed writes.
- Scope gates: no tests prove `content:read` cannot perform writes, `content:write` can perform writes without `content:read` where allowed, or old product write routes enforce coarse write scope.
- Bootstrap boundaries: no tests for second bootstrap after an org admin exists, bootstrap with wrong token `org_id`, or recovery-only behavior.
- Last-admin invariant: no tests for revoking the last `org.content_admin`.
- Sensitive target validation: no tests for `book.sharing_manager` target membership or ownership transfer to a non-member.
- Content IAM idempotency: no tests reusing the same idempotency key across different books, orgs, roles, or ownership-transfer paths.
- Expiration behavior: no tests for expired binding/denial recreation.
- Repository policy queries: no D1-backed tests for direct user allow, team allow, service account allow, expired binding deny, expired denial no longer denying, inherited parent denial, or cross-resource boundary safety.
- Resource model: no tests for chapter/section/block/comment/bookmark hierarchy because the resources do not exist yet.
- Rate/retention behavior: no tests for repeated denied mutation audit events or rate limiting, even though docs call it out.

## Documentation Gaps

- Docs 006 and 007 are marked implemented while many checklist items remain unchecked.
- Docs 007 says the implementation covers books, chapters, sections, comments, media, and reading features, but the code only provides org/book policy administration plus a minimal book table.
- README says to set `ID_PRINCIPAL_VALIDATION_TOKEN`, but the `id` contract says the caller uses a dedicated M2M token with audience/scope. The README should not normalize a static secret token model.
- README required GitHub secrets omit the new principal-validation secret or replacement M2M credentials.
- The deferral of the full book system is not clearly captured as a new numbered plan. If chapter/section/comment/bookmark work is intentionally deferred, that should be explicit and reflected in the docs status list.

## Positive Notes

- The current hard gates pass.
- The token verifier correctly removed `token_use` and JWT role-derived admin behavior.
- Direct-share tokens with `content:share` are rejected by the current verifier.
- Service-account actors are not treated as implicit admins.
- Content IAM policy checks do denials before allows.
- The route layer is thin and uses OpenAPI route registration consistently.

## Recommended Next Review Gate

Before this implementation is accepted as docs 006/007 complete, require:

1. Principal validation redesigned around the real `id` M2M audience/scope contract.
2. GitHub deploy secret wiring or M2M credential wiring updated.
3. Local user projection fixed so `users.id = id.sub` is possible through supported flows.
4. Bootstrap and last-admin workflows constrained to the documented local IAM boundary.
5. Content IAM idempotency scoped to concrete resources.
6. Docs 007 status corrected to partial, or the missing book/chapter/section/comment/bookmark resource model implemented.
7. Focused tests added for the gaps above, especially those that currently pass by mock shortcuts.
