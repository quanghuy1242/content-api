# `id` Project Map (from content-api's perspective)

You usually do not edit `~/pjs/auth` from content-api work. But some changes require coordinated edits in both repos. This file captures **only what content-api needs to know** — do not chase additional `id` docs while implementing.

## When You Need To Touch `id`

| Change in content-api | Required `id` change |
|---|---|
| Add a new OAuth scope (e.g. `content:export`) | Add a row in `oauthResourceScope` for `resourceServerId = rs_content`; enable it. |
| Add a new resource-server audience | Register a new `resourceServer` row + audience; add `oauthResourceScope` rows. |
| Bind a service account in a new org | Create an `oauthClientOrganizationGrant` for the client/org/audience with the right `allowedScopes`. |
| Extend `ContentPrincipalDirectory` with a new validation method | Extend the SCIM directory adapter + potentially add a new SCIM or OAuth picker route in `id`. |
| Add a new claim to the user token (e.g. `locale`) | Extend `customAccessTokenClaims` in `id`'s `oauthProvider(...)` and the `Actor` projection here. |
| Enable a new team or change team semantics | Almost always a config change in `id`; content-api consumes via `team_ids`. |

For all other content-api work — adding permissions, roles, bindings, denials, resource types, IAM mutation use cases — `id` does **not** change.

## The Five SCIM + OAuth Picker Calls content-api Makes

Base URL = `ID_SCIM_URL`. All require the M2M token from `ClientCredentialsTokenProvider` (scope `identity:directory:read oauth:clients:read`, audience `ID_SCIM_AUDIENCE`).

| HTTP | Path | Validates |
|---|---|---|
| GET | `/api/auth/scim/v2/Users/:id` | User exists in `id` |
| GET | `/api/auth/scim/v2/tenants/:orgId/Users/:id` | User is a member of that org |
| GET | `/api/auth/scim/v2/tenants/:orgId/Groups/:id` | Team exists and belongs to that org |
| GET | `/api/auth/admin/oauth-clients/lookup?client_id=&org_id=&resource=` | Client enabled, has grant for org + resource |
| GET | `/api/auth/scim/v2/tenants/:orgId/Groups?filter=id eq "org-admins" and members.value eq ":id"` | User is an org admin |

All calls use GET with the same M2M bearer token. The token scope is `identity:directory:read oauth:clients:read` and the audience is `{idBaseUrl}/system`. This replaces the old `principal-validation` POST endpoints that have been deprecated and removed (A5).

Responses: `200 OK` on success, `401` on caller-token issues, `404` on not found. The adapter [src/infrastructure/identity/scim-content-principal-directory.ts](../../../src/infrastructure/identity/scim-content-principal-directory.ts) translates non-2xx into `ValidationError`.

## What `id` Will Never Do For You

- Decide whether a content action is allowed.
- Enumerate users, teams, or service accounts for you (no list/search API).
- Push membership-change events. There is no webhook; you live within the 15-minute access-token SLA.
- Issue tokens with custom permission claims (it issues OAuth scopes only).

## What content-api Must Never Do To `id`

- Read `id`'s D1 database directly.
- Call admin endpoints (`/api/auth/admin/...`) from runtime code except the `oauth-clients/lookup` picker endpoint.
- Cache validation responses beyond the M2M token's own KV cache; each policy write must re-validate.
- Send the internal `resourceServerId` value across the network — always pass the public OAuth `resource` audience and let `id` resolve it.

## Environment Variables (content-api side)

Set in `wrangler.jsonc`, `wrangler.test.jsonc`, and via secrets at deploy. Schema: [src/config/env.ts](../../../src/config/env.ts).

- `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URL`, `AUTH_REQUIRED_SCOPE` — verify the inbound user/M2M token.
- `ID_SCIM_URL` — `id` base URL (e.g. `https://id.example.com`).
- `ID_SCIM_TOKEN_URL` — optional, defaults to `<base>/api/auth/oauth2/token`.
- `ID_SCIM_CLIENT_ID`, `ID_SCIM_CLIENT_SECRET` — content-api's dedicated M2M client for SCIM directory (provisioned in `id` separately from the public content client).
- `ID_SCIM_AUDIENCE` — audience for the SCIM/OAuth picker APIs in `id` (distinct from `AUTH_AUDIENCE`).
- `ID_SCIM_SCOPE` — must be `identity:directory:read oauth:clients:read`.
- `ID_SCIM_TOKEN_CACHE` — KV binding for caching the M2M token.

When adding a new env var, update both `wrangler.jsonc` and `wrangler.test.jsonc`, and the `envSchema` plus `AppBindings` type in `src/config/env.ts`.
