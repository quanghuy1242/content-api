---
name: content-iam-usage
description: Source of truth for using and extending Content IAM in the content-api repo and for interacting with the `id` (auth) project. Use this skill whenever adding/changing a permission, role, principal, policy binding/denial, scope check, SCIM directory call, IAM mutation use case, or IAM-aware route in content-api. Self-contained — do not depend on `/home/quanghuy1242/pjs/auth/docs` or `docs/007_content-iam-policy-binding-model.md` while working; this skill captures the contract.
---

# Content IAM Usage (content-api)

This skill is the authoritative usage guide for **Content IAM** in `content-api`. It owns:

- the boundary between `id` (authoritative identity / OAuth) and `content-api` (authoritative content authorization),
- the token claim contract `content-api` accepts from `id`,
- naming conventions for permissions, roles, principals, resources, and routes,
- the patterns for adding a permission, role, resource type, IAM mutation, or guarded action,
- the SCIM directory contract used during durable IAM writes.

Do not invent new patterns. Match the existing files first; if unsure, read the referenced source paths in this skill, not external docs.

---

## 1. Boundary — Who Owns What

`id` (Better Auth + OAuth provider, repo `~/pjs/auth`) owns:

- users, sessions, organizations, members, **teams**, team membership;
- OAuth clients and service-account principal identity;
- resource-server audiences and resource-server-bound OAuth **scopes** (`content:read`, `content:write`, `content:share`);
- JWT signing + JWKS (`AUTH_JWKS_URL`);
- token issuance for PKCE, refresh, and M2M flows;
- **authenticated exact-ID principal validation** for durable references (SCIM directory + OAuth client picker).

`content-api` owns:

- content resources (`org`, `book`, `post`, `category`, `chapter`, `section`, `block`, `comment`, `media`);
- **content permissions** (code-owned keys, e.g. `book.update`);
- **content roles** (system roles seeded from code; tenant roles in D1);
- role → permission mappings;
- **policy bindings** (principal → role on a concrete resource);
- **policy denials** (explicit deny that always wins);
- resource hierarchy + inheritance;
- final `ContentPolicy.can(...)` decisions;
- policy audit events;
- a **local user projection** keyed on `id.sub`.

`id` never decides whether `user_x` may update `book_y`. `content-api` never decides whether `user_x` is in `org_y`. Cross only through:

1. JWT claims on the request (read-only assertions from `id`);
2. the SCIM directory HTTP API (write-time exact-ID checks).

Never invent a third channel (no shared DB, no scraping `id` admin endpoints, no cached membership beyond the JWT lifetime).

---

## 2. Token Contract You Receive From `id`

Every authenticated request carries a JWT verified against `AUTH_JWKS_URL` with `aud == AUTH_AUDIENCE` and `iss == AUTH_ISSUER`. The auth use case projects it into an `Actor` ([src/domain/auth/actor.ts](../../../src/domain/auth/actor.ts)).

### 2.1 `Actor` variants

```ts
type UserActor = {
  type: "user";
  subject: string;          // id.sub — the stable user principal id
  organizationId?: string;  // present = workspace token; absent = direct-share token
  teamIds: readonly string[];
  scopes: readonly string[];
  role: "admin" | "user";
  // ...display fields
};

type ServiceAccountActor = {
  type: "service_account";
  clientId: string;         // OAuth client id; the stable service-account principal id
  organizationId: string;   // org-scoped M2M only
  scopes: readonly string[];
};

type SystemActor = { type: "system"; id: "queue" | "cron" | "migration" };
```

### 2.2 Three issuance contexts

| Context | `org_id` claim | `team_ids` | Allowed scopes | Use |
|---|---|---|---|---|
| Workspace user | yes — must match `resource.orgId` | teams in that org | `content:read`, `content:write`, `content:share` | Org-authority actions, IAM mutation |
| Direct-share user | absent | `[]` always | `content:read`, `content:write` only (no `content:share`) | External collaborator with a direct binding |
| M2M service account | yes when org-scoped | n/a (not carried) | per client+org grant | Imports, automation |

Rules `content-api` enforces locally:

- Workspace token with `org_id != resource.orgId` → **reject**, never downgrade to direct-share. See `principalsForActor` in [src/domain/iam/content-policy.ts](../../../src/domain/iam/content-policy.ts).
- Direct-share token (`actor.organizationId === undefined`) contributes only the `{ type: "user", id: actor.subject }` principal. Teams are dropped because the token carries `team_ids=[]`.
- Service-account token contributes `{ type: "service_account", id: actor.clientId }` and only when `actor.organizationId === resource.orgId`.
- User access tokens have a **15-minute** lifetime. Treat `team_ids` as fresh for at most that window. Do not call `id` to revalidate per request.

### 2.3 Scope gate, then policy gate

Every protected use case follows this order (see [src/application/books/update-book.usecase.ts](../../../src/application/books/update-book.usecase.ts)):

```ts
requireContentScope(actor, "content:write");   // OAuth capability gate
const resource = await loadBookResource(...);  // resolve org + ancestors
const allowed = await this.contentPolicy.can({
  actor, permission: "book.update", resource,
});
if (!allowed) throw new ForbiddenError("...");
```

Helpers live in [src/domain/auth/scopes.ts](../../../src/domain/auth/scopes.ts). Scopes:

- `content:read` — read private/draft content
- `content:write` — mutate content (including IAM-mutation routes themselves)
- `content:share` — manage bindings/denials/ownership (workspace tokens only)

Never invent a new OAuth scope inside `content-api`. New OAuth scopes are owned by `id`'s scope-catalog plugin and must be added there first.

---

## 3. Vocabulary & Naming Conventions

These are non-negotiable. Stick to them so the architecture lint, oxlint plugin, and tests keep passing.

### 3.1 Permission keys (`ContentPermissionKey`)

Single string of the form `<resourceType>.<verb>` in **snake_case** for the verb when multi-word. Source of truth: `CONTENT_PERMISSIONS` in [src/domain/iam/content-permission.ts](../../../src/domain/iam/content-permission.ts).

- Resource types: `org`, `book`, `post`, `category`, `chapter`, `section`, `block`, `comment`, `inline_comment`, `media`.
- Verbs: `read`, `create`, `update`, `delete`, `publish`, `attach`, `comment`, `moderate`, `manage_bindings`, `manage_roles`, `transfer_ownership`, `create_<child>` (org-level creators).
- Sensitivity is encoded by `delegationClass`: `"ordinary" | "policy_management" | "ownership_transfer" | "organization_admin"`. Choose the lowest class that is still safe — anything above `ordinary` triggers protected workflows.

### 3.2 Role IDs

- **Built-in/system roles**: id prefix `system:`, key prefix matches resource type. Examples: `system:org.content_admin`, `system:book.owner`, `system:book.sharing_manager`, `system:book.editor`. Defined in `BUILT_IN_CONTENT_ROLES`.
- **Tenant-defined roles**: id is generated; key is unique within `(orgId, assignableResourceType)`. Cross-org role assignment is rejected by the administration policy.
- Set `protected: true` only if the role is required for system invariants (owner, sharing_manager, content_admin). Protected roles cannot be deleted or have their permissions replaced.

### 3.3 Principal types (`PrincipalType`)

Exactly three: `"user" | "team" | "service_account"`. Never invent `member`, `group`, `client`, or `bot`.

- `user.id` = `id.sub` (Better Auth user id).
- `team.id` = Better Auth `team.id` (one-org scope is guaranteed by `id`).
- `service_account.id` = OAuth `client_id` (we emit/consume it as `azp` or `client_id` claim).

### 3.4 Resource types (`ContentResourceType`)

`"org" | "book" | "post" | "category" | "chapter" | "section" | "block" | "media" | "comment"`. Every concrete resource has an `orgId` even when its type is `"org"` (then `id == orgId`). Build the canonical `ContentResourceRef` via the helpers in [src/domain/iam/resource-loader.ts](../../../src/domain/iam/resource-loader.ts) — `bookResource(book)`, `postResource(post)`, `categoryResource`, `mediaResource`, `organizationResource(orgId)`. Ancestors must be ordered from nearest parent to root org.

### 3.5 Routes

GCP-style nested under the resource:

- Org-scoped IAM: `/organizations/{orgId}/policy-bindings`, `/organizations/{orgId}/policy-denials`, `/organizations/{orgId}/policy-events`, `/organizations/{orgId}/content-roles`, `/organizations/{orgId}/content-admins[/{bindingId}]`.
- Book-scoped IAM: `/books/{bookId}/policy-bindings`, `/books/{bookId}/policy-denials`, `/books/{bookId}/policy-events`, `/books/{bookId}/transfer-ownership`.
- Org IAM routes live in [src/http/routes/content-iam.routes.ts](../../../src/http/routes/content-iam.routes.ts); book IAM routes live in [src/http/routes/books.routes.ts](../../../src/http/routes/books.routes.ts).

Always pass `Idempotency-Key` on mutation routes (enforced by `requireIdempotencyKey`).

### 3.6 File naming inside layers

- `src/domain/iam/<thing>.entity.ts`, `<thing>.repository.ts`, `<thing>.policy.ts`, `<thing>.workflow.ts`.
- `src/application/content-iam/<verb>-<thing>.usecase.ts` (e.g. `create-policy-binding.usecase.ts`).
- `src/infrastructure/repositories/drizzle-<thing>.repository.ts`, `drizzle-<thing>-<workflow>.workflow.ts`.
- `src/infrastructure/repositories/mappers/<thing>.mapper.ts` for row↔entity mapping (one-to-one fields, no business logic).
- Constants for route names: append to `src/shared/constants.ts` and re-export, used by idempotency snapshot keys.

---

## 4. Adding A New Permission (Recipe)

When you must gate a new action:

1. Decide the **scope** at the OAuth layer first: read vs write vs share. If it is policy/sharing mutation, scope is `content:share`.
2. Add the key + description + delegation class to `CONTENT_PERMISSIONS` in [src/domain/iam/content-permission.ts](../../../src/domain/iam/content-permission.ts). Choose `delegationClass`:
   - `ordinary` — feature work, can be granted to teams.
   - `policy_management` — managing bindings on this resource; user-only.
   - `ownership_transfer` — transferring ownership; user-only, dedicated workflow.
   - `organization_admin` — org-wide IAM administration; user-only, dedicated workflow.
3. Append the key to the existing built-in roles in `BUILT_IN_CONTENT_ROLES` that should carry it (e.g. `system:book.owner`, `system:book.editor`). The `ContentRoleRepository.ensureSystemCatalog()` call inside IAM use cases reseeds them.
4. If a brand-new resource type is involved, see §5 below.
5. Use it in the use case: `await this.contentPolicy.can({ actor, permission: "<new.key>", resource })`.
6. Update tests under `tests/` that cover the use case — denial precedence, allow path, scope-only-without-binding.
7. Run `pnpm check`.

Do **not**:

- Add a permission key that doesn't appear in `CONTENT_PERMISSIONS` — `assertContentPermissionKey` throws.
- Decide `delegationClass` based on UI labelling; decide on blast radius.
- Mutate `BUILT_IN_CONTENT_ROLES` after release without adding a migration that updates tenants' inherited rows (built-ins are seeded on demand, but if you remove a permission from a built-in, existing bindings still reference the role — write a migration if needed).

---

## 5. Adding A New Resource Type (Recipe)

Example: adding `chapter` as a fully IAM-tracked resource.

1. Extend `ContentResourceType` in [src/domain/iam/content-permission.ts](../../../src/domain/iam/content-permission.ts).
2. Add a helper to [src/domain/iam/resource-loader.ts](../../../src/domain/iam/resource-loader.ts):

   ```ts
   export function chapterResource(chapter: Chapter): ContentResourceRef {
     return {
       type: "chapter",
       id: chapter.id,
       orgId: chapter.orgId,
       ancestors: [
         { type: "book", id: chapter.bookId },
         { type: "org", id: chapter.orgId },
       ],
     };
   }
   ```

   Order ancestors from nearest parent to root org so inheritance evaluation in `bindingRefsForResource` walks correctly.
3. Add permission keys to `CONTENT_PERMISSIONS` (`chapter.read`, `chapter.update`, …) and wire them into the relevant built-in roles.
4. Update `loadContentResource` and `ContentResourceInput` only if the new resource is itself a **policy-binding target** (i.e. you intend `policy-bindings` routes scoped to it). Otherwise rely on inheritance from a higher resource.
5. Add tests: ancestor expansion, denial-at-ancestor blocks descendant, allow-at-descendant alone allows.

---

## 6. Adding A New Role (Recipe)

### 6.1 Built-in / system role

Only add a built-in if it embodies a system invariant (must exist before any IAM mutation can succeed, or is referenced by a workflow). Otherwise prefer letting tenants define their own role through the `POST /organizations/{orgId}/content-roles` route.

1. Append to `BUILT_IN_CONTENT_ROLES` with `id = "system:<scope>.<key>"`, deterministic. Set `assignableResourceType` to the **single** resource type it can be bound to.
2. `protected: true` only for owner-class or admin-class roles.
3. Permissions list is the closed set for this role; do not compose at runtime.
4. The role is automatically seeded by `ContentRoleRepository.ensureSystemCatalog()` on next IAM use case execution.

### 6.2 Tenant role

Use the existing `CreateContentRoleUseCase` and `ReplaceContentRolePermissionsUseCase`. Tenants only need callers with `org.manage_roles`.

---

## 7. Adding A New IAM Mutation Use Case (Recipe)

Use this whenever the action persists a new binding, denial, role-assignment, or ownership change. Existing examples: [src/application/content-iam/create-policy-binding.usecase.ts](../../../src/application/content-iam/create-policy-binding.usecase.ts).

Required steps in order:

1. **Resolve the resource**: `const resource = await loadContentResource(this.books, params.resource);` — never accept a free-form `orgId` from input without verifying it via the loaded resource.
2. **Ensure system catalog**: `await this.roles.ensureSystemCatalog();`
3. **Reject cross-org roles**: tenant-defined roles must have `role.namespaceId === resource.orgId`; system roles have `"system"`.
4. **Authorize via `ContentAdministrationPolicy`**: this is the only place that derives delegation class and decides whether `policy_management` / `ownership_transfer` / `organization_admin` workflows apply. See [src/domain/iam/content-administration.policy.ts](../../../src/domain/iam/content-administration.policy.ts).
5. **On denial, record `policy_event`** via `recordDeniedPolicyMutation(...)` from [src/domain/iam/audit-denied-mutation.ts](../../../src/domain/iam/audit-denied-mutation.ts) **before re-throwing** the policy error. Rate limiting is handled by `0004_content_iam_guards`.
6. **Validate the target principal exists** in `id`: call the appropriate `ContentPrincipalDirectory` method — see §8.
7. **Wrap the mutation in idempotency**: `executeIdempotentContentIamMutation({ idempotency, key: requireIdempotencyKey(params.idempotencyKey), actor, route: CONST_FROM_SHARED, input: { body: params.input }, responseJson: () => serialize...(...), apply: async () => workflow.run(...) })`.
8. **Persist via a workflow port**, never via a raw repository. Workflows live in `src/infrastructure/repositories/drizzle-*-*.workflow.ts` and own D1 batch construction.
9. **Always emit a `policy_event`** on success too; serialize the before/after into the snapshot JSON.

Common pitfalls:

- Calling `principalDirectory` inside `ContentPolicy.can()` — forbidden. `can()` is hot-path and read-only.
- Treating the missing `Idempotency-Key` header as soft; `requireIdempotencyKey` throws `ValidationError` and that is intentional.
- Recording the denial event from a presenter or middleware. The denial event is part of the use-case contract.

---

## 8. SCIM Directory (Calling Back To `id`)

Used only by **durable** IAM writes to verify that referenced principals exist with the right shape. Never call this from a hot-path policy check.

Configuration (already present in [src/config/env.ts](../../../src/config/env.ts)):

- `ID_SCIM_URL` — base URL of the `id` core worker (e.g. `https://id.example.com`).
- `ID_SCIM_TOKEN_URL` (optional) — defaults to `<base>/api/auth/oauth2/token`.
- `ID_SCIM_CLIENT_ID` / `ID_SCIM_CLIENT_SECRET` — the dedicated M2M client provisioned in `id`.
- `ID_SCIM_AUDIENCE` — the SCIM directory API's audience in `id` (NOT the content-api audience).
- `ID_SCIM_SCOPE` — must be `identity:directory:read oauth:clients:read`.
- `ID_SCIM_TOKEN_CACHE` — KV namespace used by `ClientCredentialsTokenProvider` to cache the M2M token.

Adapter: [src/infrastructure/identity/scim-content-principal-directory.ts](../../../src/infrastructure/identity/scim-content-principal-directory.ts).

Interface: [src/domain/iam/content-principal-directory.ts](../../../src/domain/iam/content-principal-directory.ts).

| Method | SCIM/OAuth call | Validates | Call it for |
|---|---|---|---|
| `validateUser({ userId })` | `GET /scim/v2/Users/:id` | User exists in `id` | Ordinary external direct-user binding (collaborator without org membership) |
| `validateUserInOrganization({ userId, orgId })` | `GET /scim/v2/tenants/:orgId/Users/:id` | User exists **and is a current member** of `orgId` | Owner / sharing_manager / `org.content_admin` user targets, sensitive book bindings |
| `validateTeamInOrganization({ teamId, orgId })` | `GET /scim/v2/tenants/:orgId/Groups/:id` | Team exists and `team.organizationId === orgId` | Any team binding |
| `validateServiceAccountForOrganization({ clientId, orgId, resource })` | `GET /admin/oauth-clients/lookup?client_id=&org_id=&resource=` | Client enabled + has grant for `orgId` and the **public** `resource` audience | Service-account binding; pass the **public** content-api audience (`AUTH_AUDIENCE`) here — `id` resolves it to its internal `resourceServerId` |
| `validateOrganizationAdministrator({ userId, orgId })` | `GET /scim/v2/tenants/:orgId/Groups?filter=id eq "org-admins" and members.value eq ":id"` | User is a current Better Auth `owner`/`admin` of `orgId` | Bootstrap or recovery of the first local `org.content_admin` binding only |

All calls use GET with the same M2M bearer token. Token scope: `identity:directory:read oauth:clients:read`. Token audience: `{idBaseUrl}/system`.

Rules:

- Choose the **lowest-power** validation method that still proves what you need. Using `validateUserInOrganization` everywhere blocks legitimate direct-share collaborators.
- Pass the public OAuth audience (`AUTH_AUDIENCE` env var) to `validateServiceAccountForOrganization` — never the internal `resource_server_id`.
- A failed validation throws `ValidationError` or `UnauthorizedError`; surface those normally — do not retry, the contract is exact-ID.
- This API is not a directory/search API. Never iterate.

---

## 9. ContentPolicy Evaluation (How `can` Works)

Implementation: `LocalContentPolicy` in [src/domain/iam/content-policy.ts](../../../src/domain/iam/content-policy.ts).

Algorithm:

1. `principalsForActor(actor, resource.orgId)` builds the principal set. Wrong org → empty set → deny.
2. `bindingRefsForResource(resource)` expands to the resource itself plus all ancestors (with `direct: false` for ancestors).
3. **Denial check first**: any active matching `content_policy_denials` row wins → deny.
4. **Allow check**: `bindings.hasAllowedPermission(...)` returns true if any binding grants the permission through a role that contains it.

Invariants you must preserve:

- Denials override allows at any level of the hierarchy.
- A `content:read`-only actor cannot mutate; the scope check happens before `can(...)`.
- `canMany` exists for list endpoints — use it instead of calling `can` in a loop.

Caching: there is **no** cross-request policy cache. Do not add one without a documented invalidation strategy.

---

## 10. Layer Discipline (Reminders That Bite In Code Review)

Architecture lint (`pnpm lint`) enforces these. If lint flags you, fix the code — never loosen the rule.

- `domain/**` may not import `hono`, `drizzle-orm`, `cloudflare:*`, or anything in `infrastructure/` or `http/`.
- `application/**` depends only on `domain/` interfaces and `shared/errors`.
- `http/**` routes are: `validate input → call one use case → present output`. No business logic, no Drizzle, no policy calls outside the use case.
- `infrastructure/**` implements `domain` interfaces. Row ↔ entity mapping lives in `mappers/*.mapper.ts`; do not inline it.
- `composition/**` wires everything per-request.
- New permission/role/binding decisions must be reachable from a use case, never from middleware.

After substantive changes run:

```sh
pnpm lint
pnpm check:dup
pnpm typecheck
pnpm test
pnpm advise   # treat as review input; suppression policy in CLAUDE.md
```

---

## 11. Deeper References (Load Only When Needed)

Local files (do not chase external docs):

- [references/token-contract.md](references/token-contract.md) — full claim contract for workspace, direct-share, and M2M tokens; failure modes; refresh behavior.
- [references/recipes.md](references/recipes.md) — worked examples: gating a new route, adding a chapter resource end-to-end, bootstrapping the first org admin.
- [references/id-project-map.md](references/id-project-map.md) — the parts of `~/pjs/auth` you need to coordinate with when adding a scope, audience, M2M grant, or SCIM directory method.

Code anchors (preferred reading order if confused):

1. [src/domain/iam/content-permission.ts](../../../src/domain/iam/content-permission.ts) — vocabulary.
2. [src/domain/iam/content-policy.ts](../../../src/domain/iam/content-policy.ts) — evaluator.
3. [src/domain/iam/content-administration.policy.ts](../../../src/domain/iam/content-administration.policy.ts) — write-time authorization.
4. [src/application/content-iam/create-policy-binding.usecase.ts](../../../src/application/content-iam/create-policy-binding.usecase.ts) — canonical IAM mutation use case.
5. [src/application/books/update-book.usecase.ts](../../../src/application/books/update-book.usecase.ts) — canonical IAM-aware feature use case.
6. [src/http/routes/content-iam.routes.ts](../../../src/http/routes/content-iam.routes.ts) — org-scoped IAM routes.
7. [src/infrastructure/identity/scim-content-principal-directory.ts](../../../src/infrastructure/identity/scim-content-principal-directory.ts) — SCIM directory adapter.

---

## 12. Quick Decision Table

| You need to … | Do this |
|---|---|
| Gate a new action behind OAuth | `requireContentScope(actor, "content:read" / "write" / "share")` |
| Gate a new action behind a permission | Add key to `CONTENT_PERMISSIONS` + call `contentPolicy.can(...)` |
| Allow tenants to define a new role | They use `POST /organizations/{orgId}/content-roles` — no code change |
| Add a system invariant role | Append to `BUILT_IN_CONTENT_ROLES` with `system:` id, `protected: true` if load-bearing |
| Add a new resource type | Extend `ContentResourceType`, add a `*Resource(...)` helper, list ancestors nearest-first |
| Bind a principal to a role on a resource | Use `CreatePolicyBindingUseCase` (org or book) — never write the row directly |
| Block an actor from a permission | Use `CreatePolicyDenialUseCase`; denial always wins |
| Verify a user/team/SA target exists in `id` | Call the matching `ContentPrincipalDirectory` method (§8 — SCIM directory) |
| Change OAuth scope set | Coordinate in `~/pjs/auth` first; `content-api` only consumes |
| Make a hot-path call to `id` | **Don't.** Read JWT claims; live within the 15-minute SLA |
