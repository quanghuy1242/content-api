# Token Contract Reference

Detailed claim contract for the JWTs `content-api` accepts from `id`. Use this when debugging an `Unauthorized`, `Forbidden`, or wrong-org rejection, or when adding a new actor-aware feature.

## Verification (already wired in `AuthenticateBearerTokenUseCase`)

For every request with an `Authorization: Bearer ...` header:

1. Verify signature against the JWKS at `AUTH_JWKS_URL`.
2. Verify `iss == AUTH_ISSUER`.
3. Verify `aud == AUTH_AUDIENCE` (the public content-api audience).
4. Verify `exp` is in the future.
5. Project into `Actor`.

If any step fails the request gets `401`. The `optionalAuthMiddleware` swallows missing headers (so unauthenticated GETs work), but **any present header** must verify cleanly.

## Workspace User Access Token

Issued when the user explicitly selected a workspace organization at consent.

```json
{
  "iss": "https://id.example.com/api/auth",
  "aud": "https://content-api.example.com",
  "azp": "web_editor_app",
  "sub": "user_alice",
  "org_id": "org_1",
  "scope": "content:read content:write content:share",
  "team_ids": ["team_editorial"],
  "exp": <issued + 900>
}
```

Projects to:

```ts
{ type: "user", subject: "user_alice", organizationId: "org_1",
  teamIds: ["team_editorial"], scopes: [...], role: "user", ... }
```

Local rules:

- `actor.organizationId !== resource.orgId` → `principalsForActor` returns `[]` → deny. Do **not** treat this as direct-share; reject explicitly.
- `team_ids` are valid only inside `actor.organizationId`. The principal builder won't add team principals when org doesn't match.
- 15-minute lifetime is the entire stale-identity window for JWT-only enforcement. Refreshing produces a token with current `team_ids`.

## Direct-Share User Access Token

Issued when the user explicitly selected direct-share context (no org).

```json
{
  "iss": "...",
  "aud": "https://content-api.example.com",
  "azp": "web_editor_app",
  "sub": "user_external",
  "scope": "content:read content:write",
  "team_ids": [],
  "exp": <issued + 900>
}
```

Notes:

- `org_id` is absent (`actor.organizationId === undefined`).
- `team_ids` is always `[]`. The reserved internal direct-share consent marker (`urn:id:oauth-context:direct-share`) is never exposed as `org_id`.
- `content:share` will **never** appear; `id` rejects it for this context.
- `principalsForActor(actor, anyOrgId)` returns `[{ type: "user", id: actor.subject }]`. The user can then only act on resources where they have a direct user binding.
- Allowed: reading/writing inside a directly shared subtree (e.g. creating a chapter inside a book on which they hold `book.author` directly).
- Disallowed: creating top-level org resources, mutating bindings, accessing other orgs' content without a binding.

## M2M Service-Account Token

Org-scoped client credentials flow.

```json
{
  "iss": "...",
  "aud": "https://content-api.example.com",
  "azp": "import_bot_client",
  "client_id": "import_bot_client",
  "org_id": "org_1",
  "scope": "content:write",
  "exp": <issued + 10800>
}
```

Notes:

- Lifetime is 3 hours (`m2mAccessTokenExpiresIn = 10_800` in `id`'s config). Treat membership/grant changes as having a 3-hour stale window.
- No `team_ids` — service accounts don't carry team authority.
- Bind via `principal_type = "service_account"`, `principal_id = client_id`.
- Org-scoped M2M without an `oauthClientOrganizationGrant` for the requested audience won't be issued by `id` — if you see one, treat it as a config drift incident.

## Refresh Semantics

- Every refresh re-evaluates organization membership, team membership, and scope eligibility against the live `id` state.
- The 7-day refresh-token lifetime does **not** extend the staleness of already-issued access tokens.
- A direct-share refresh stays direct-share; it cannot promote to a workspace token without a fresh user consent.

## Failure Modes (Cheat Sheet)

| Symptom | Likely cause | Where to fix |
|---|---|---|
| 401 on every request | JWKS unreachable, audience mismatch, clock skew | env: `AUTH_JWKS_URL`, `AUTH_AUDIENCE`, `AUTH_ISSUER` |
| 403 with valid token | Scope missing, org mismatch, no binding | check `actor.scopes`, `actor.organizationId`, denials |
| Action allowed via API but denied in `can()` | Wrong scope (`content:write` vs `content:share`) — IAM mutation routes require `content:write` AND go through `ContentAdministrationPolicy` | use case |
| Team principal not contributing | `actor.organizationId !== resource.orgId`, or token was direct-share | `principalsForActor` |
| Recently removed team member still allowed | Within 15-minute access-token window; expected | wait or accept SLA |
| Service-account binding rejected at write-time | Grant missing in `id`'s `oauthClientOrganizationGrant`, or wrong audience passed | re-provision in `id`; pass `AUTH_AUDIENCE` to `validateServiceAccountForOrganization` |
