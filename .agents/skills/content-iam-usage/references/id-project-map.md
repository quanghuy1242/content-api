# `id` Project Map (from content-api's perspective)

You usually do not edit `~/pjs/auth` from content-api work. But some changes require coordinated edits in both repos. This file captures **only what content-api needs to know** — do not chase additional `id` docs while implementing.

## When You Need To Touch `id`

| Change in content-api | Required `id` change |
|---|---|
| Add a new OAuth scope (e.g. `content:export`) | Add a row in `oauthResourceScope` for `resourceServerId = rs_content`; enable it. |
| Add a new resource-server audience | Register a new `resourceServer` row + audience; add `oauthResourceScope` rows. |
| Bind a service account in a new org | Create an `oauthClientOrganizationGrant` for the client/org/audience with the right `allowedScopes`. |
| Add a new principal-validation method | Extend the `id` principal-validation plugin endpoint + the content-api `ContentPrincipalDirectory` interface + adapter (`IdContentPrincipalDirectory`). |
| Add a new claim to the user token (e.g. `locale`) | Extend `customAccessTokenClaims` in `id`'s `oauthProvider(...)` and the `Actor` projection here. |
| Enable a new team or change team semantics | Almost always a config change in `id`; content-api consumes via `team_ids`. |

For all other content-api work — adding permissions, roles, bindings, denials, resource types, IAM mutation use cases — `id` does **not** change.

## The Five `id` Endpoints content-api Calls

Base URL = `ID_PRINCIPAL_VALIDATION_URL`. All require the M2M token from `ClientCredentialsTokenProvider` (scope `identity:principals:validate`, audience `ID_PRINCIPAL_VALIDATION_AUDIENCE`).

| HTTP | Path | Body | Throws when |
|---|---|---|---|
| POST | `/api/auth/principal-validation/users/validate` | `{ userId }` | User doesn't exist in `id` |
| POST | `/api/auth/principal-validation/users/validate-organization-member` | `{ userId, organizationId }` | User not a member of that org |
| POST | `/api/auth/principal-validation/teams/validate-organization-team` | `{ teamId, organizationId }` | Team doesn't exist or belongs to a different org |
| POST | `/api/auth/principal-validation/service-accounts/validate-organization-grant` | `{ clientId, organizationId, resource }` | Client disabled, no grant, or wrong audience |
| POST | `/api/auth/principal-validation/organization-administrators/validate` | `{ userId, organizationId }` | User isn't a current Better Auth `owner`/`admin` for the org |

Responses are `204 No Content` on success, `401` on caller-token issues, anything else on validation failure. The adapter [src/infrastructure/identity/id-content-principal-directory.ts](../../../src/infrastructure/identity/id-content-principal-directory.ts) translates non-2xx into `UnauthorizedError`/`ValidationError`.

## What `id` Will Never Do For You

- Decide whether a content action is allowed.
- Enumerate users, teams, or service accounts for you (no list/search API).
- Push membership-change events. There is no webhook; you live within the 15-minute access-token SLA.
- Issue tokens with custom permission claims (it issues OAuth scopes only).

## What content-api Must Never Do To `id`

- Read `id`'s D1 database directly.
- Call admin endpoints (`/api/auth/admin/...`) from runtime code.
- Cache validation responses beyond the M2M token's own KV cache; each policy write must re-validate.
- Send the internal `resourceServerId` value across the network — always pass the public OAuth `resource` audience and let `id` resolve it.

## Environment Variables (content-api side)

Set in `wrangler.jsonc`, `wrangler.test.jsonc`, and via secrets at deploy. Schema: [src/config/env.ts](../../../src/config/env.ts).

- `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URL`, `AUTH_REQUIRED_SCOPE` — verify the inbound user/M2M token.
- `ID_PRINCIPAL_VALIDATION_URL` — `id` base URL (e.g. `https://id.example.com`).
- `ID_PRINCIPAL_VALIDATION_TOKEN_URL` — optional, defaults to `<base>/api/auth/oauth2/token`.
- `ID_PRINCIPAL_VALIDATION_CLIENT_ID`, `ID_PRINCIPAL_VALIDATION_CLIENT_SECRET` — content-api's dedicated M2M client (provisioned in `id` separately from the public content client).
- `ID_PRINCIPAL_VALIDATION_AUDIENCE` — audience for the principal-validation API in `id` (distinct from `AUTH_AUDIENCE`).
- `ID_PRINCIPAL_VALIDATION_SCOPE` — must be `identity:principals:validate`.
- `ID_PRINCIPAL_VALIDATION_TOKEN_CACHE` — KV binding for caching the validator's own access token.

When adding a new env var, update both `wrangler.jsonc` and `wrangler.test.jsonc`, and the `envSchema` plus `AppBindings` type in `src/config/env.ts`.
