/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import migrationSql0000 from "../drizzle/0000_dapper_korvac.sql?raw";
import migrationSql0001 from "../drizzle/0001_unique_starhawk.sql?raw";
import migrationSql0002 from "../drizzle/0002_media_upload_flow.sql?raw";
import migrationSql0003 from "../drizzle/0003_content_iam_policy.sql?raw";
import migrationSql0004 from "../drizzle/0004_content_iam_guards.sql?raw";
import migrationSql0005 from "../drizzle/0005_remove_legacy_authz.sql?raw";
import migrationSql0006 from "../drizzle/0006_content_resources_org_scope.sql?raw";
import migrationSql0007 from "../drizzle/0007_lucky_oracle.sql?raw";
import { BUILT_IN_CONTENT_ROLES, CONTENT_PERMISSIONS } from "@/domain/iam/content-permission";
import { createApp } from "@/main";
import { clearClientCredentialsTokenMemoryCache } from "@/infrastructure/identity/client-credentials-token-provider";

const AUTH_ISSUER = "https://id.test/api/auth";
const AUTH_AUDIENCE = "https://content-api.test";
const AUTH_JWKS_URL = "https://id.test/api/auth/jwks";
const ID_SCIM_URL = "https://id.test";
const ID_SCIM_TOKEN_URL = "https://id.test/api/auth/oauth2/token";
const ID_SCIM_CLIENT_ID = "content-api-scim-directory";
const ID_SCIM_CLIENT_SECRET = "scim-directory-secret";
const ID_SCIM_AUDIENCE = "https://id.test/system";
const ID_SCIM_SCOPE = "identity:directory:read oauth:clients:read";
const ID_SCIM_ACCESS_TOKEN = "scim-directory-access-token";

let privateKey: CryptoKey;
let publicJwk: JWK;
// Live binding — readable by importers, reset by setupBeforeEach, incremented by fetchImpl.
export let scimTokenRequests = 0;

export const app = createApp({
  fetchImpl: async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === AUTH_JWKS_URL) {
      return Response.json({ keys: [publicJwk] });
    }
    if (url === ID_SCIM_TOKEN_URL) {
      scimTokenRequests += 1;
      const bodyText = typeof init?.body === "string"
        ? init.body
        : init?.body instanceof URLSearchParams
          ? init.body.toString()
          : "";
      const form = new URLSearchParams(bodyText);
      if (
        form.get("grant_type") !== "client_credentials" ||
        form.get("client_id") !== ID_SCIM_CLIENT_ID ||
        form.get("client_secret") !== ID_SCIM_CLIENT_SECRET ||
        form.get("resource") !== ID_SCIM_AUDIENCE ||
        form.get("scope") !== ID_SCIM_SCOPE
      ) {
        return Response.json({ error: "invalid_client" }, { status: 401 });
      }
      return Response.json({
        access_token: ID_SCIM_ACCESS_TOKEN,
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    // Mock SCIM + OAuth picker endpoints
    if (
      url.startsWith(`${ID_SCIM_URL}/api/auth/scim/v2/`) ||
      url.startsWith(`${ID_SCIM_URL}/api/auth/admin/oauth-clients/`)
    ) {
      if (init?.headers && new Headers(init.headers).get("authorization") !== `Bearer ${ID_SCIM_ACCESS_TOKEN}`) {
        return Response.json({}, { status: 401 });
      }
      const parsedUrl = typeof url === "string" ? new URL(url) : new URL(url);
      const pathname = parsedUrl.pathname;
      const searchParams = parsedUrl.searchParams;
      const pathSegments = pathname.split("/");
      const lastSegment = pathSegments[pathSegments.length - 1] || "";

      // OAuth client picker lookup
      if (pathname === "/api/auth/admin/oauth-clients/lookup") {
        const clientId = searchParams.get("client_id");
        const orgId = searchParams.get("org_id");
        if (!clientId || !orgId) {
          return Response.json({ error: "invalid_request" }, { status: 400 });
        }
        if (clientId.startsWith("missing-") || clientId === "wrong-org" || orgId === "wrong-org") {
          return Response.json({}, { status: 404 });
        }
        return Response.json({ id: clientId, name: clientId, referenceId: orgId });
      }

      // SCIM group filter for org-admins membership check
      if (pathname.includes("/Groups") && searchParams.has("filter")) {
        const filter = searchParams.get("filter") ?? "";
        if (filter.includes("org-admins")) {
          const userIdMatch = filter.match(/members\.value eq "([^"]+)"/);
          const userId = userIdMatch ? userIdMatch[1] : null;
          const orgId = pathSegments[pathSegments.indexOf("tenants") + 1];
          if (
            !userId ||
            !orgId ||
            userId.startsWith("missing-") ||
            userId === "wrong-org" ||
            orgId.startsWith("missing-") ||
            orgId === "wrong-org"
          ) {
            return Response.json({
              schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
              totalResults: 0,
              Resources: [],
            });
          }
          return Response.json({
            schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
            totalResults: 1,
            Resources: [{
              id: "org-admins",
              displayName: "Organization Administrators",
              members: [{ value: userId, display: userId }],
            }],
          });
        }
      }

      // Sentinel values for "not found"
      if (lastSegment.startsWith("missing-") || lastSegment === "wrong-org") {
        return Response.json({}, { status: 404 });
      }

      // SCIM user endpoints (global and tenant-scoped)
      if (pathname.includes("/Users")) {
        return Response.json({ id: lastSegment, userName: lastSegment, active: true });
      }

      // SCIM group direct lookup
      if (pathname.includes("/Groups")) {
        return Response.json({ id: lastSegment, displayName: lastSegment });
      }

      return Response.json({}, { status: 404 });
    }
    return fetch(input);
  },
});

export async function issueToken(subject: string, options: {
  audience?: string;
  scope?: string;
  orgId?: string;
  teamIds?: string[];
  includeProfile?: boolean;
} = {}) {
  return new SignJWT({
    ...(options.includeProfile === false ? {} : {
      email: `${subject}@example.com`,
      name: `${subject} name`,
    }),
    scope: options.scope ?? "content:read content:write",
    ...(options.orgId ? { org_id: options.orgId, team_ids: options.teamIds ?? [] } : { team_ids: [] }),
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "JWT" })
    .setIssuer(AUTH_ISSUER)
    .setAudience(options.audience ?? AUTH_AUDIENCE)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

export async function issueServiceAccountToken(options: {
  audience?: string;
  clientId?: string;
  scope?: string;
  orgId?: string;
} = {}) {
  return new SignJWT({
    azp: options.clientId ?? "client-content-bot",
    client_id: options.clientId ?? "client-content-bot",
    scope: options.scope ?? "content:read content:write",
    org_id: options.orgId ?? "org-main",
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "JWT" })
    .setIssuer(AUTH_ISSUER)
    .setAudience(options.audience ?? AUTH_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

export async function issueWorkspaceShareToken(subject = "user-alice") {
  return issueToken(subject, {
    orgId: "org-main",
    teamIds: ["team-authors"],
    scope: "content:read content:write content:share",
  });
}

export function contentIamCatalogStatements() {
  const now = Date.now();
  const statements = CONTENT_PERMISSIONS.map((permission) => env.DB.prepare(
    "insert into content_permissions (key, description, delegation_class, enabled, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
  ).bind(permission.key, permission.description, permission.delegationClass, 1, now, now));
  for (const role of BUILT_IN_CONTENT_ROLES) {
    statements.push(
      env.DB.prepare(
        "insert into content_roles (id, namespace_id, key, name, assignable_resource_type, built_in, enabled, version, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(role.id, "system", role.key, role.name, role.assignableResourceType, 1, 1, 1, now, now),
    );
    for (const permission of role.permissions) {
      statements.push(env.DB.prepare(
        "insert into content_role_permissions (role_id, permission_key, created_at) values (?, ?, ?)",
      ).bind(role.id, permission, now));
    }
  }
  return statements;
}

export async function seed() {
  // The content_policy_bindings_last_admin_guard trigger fires when deleting
  // the last system:org.content_admin org binding, so expire those first to
  // make the WHEN condition (expires_at IS NULL OR expires_at > now) false.
  // DELETEs and INSERTs are combined in one batch so only one D1 round-trip is
  // needed; batch() processes statements in order within a single transaction.
  const dbBatch = env.DB.batch([
    env.DB.prepare("UPDATE content_policy_bindings SET expires_at = 1 WHERE role_id = 'system:org.content_admin' AND resource_type = 'org'"),
    env.DB.prepare("DELETE FROM content_iam_bootstrap_organizations"),
    env.DB.prepare("DELETE FROM content_policy_events"),
    env.DB.prepare("DELETE FROM content_policy_denials"),
    env.DB.prepare("DELETE FROM content_policy_bindings"),
    env.DB.prepare("DELETE FROM content_role_permissions"),
    env.DB.prepare("DELETE FROM content_roles"),
    env.DB.prepare("DELETE FROM content_permissions"),
    env.DB.prepare("DELETE FROM idempotency_keys"),
    env.DB.prepare("DELETE FROM posts"),
    env.DB.prepare("DELETE FROM books"),
    env.DB.prepare("DELETE FROM categories"),
    env.DB.prepare("DELETE FROM media"),
    env.DB.prepare("DELETE FROM users"),
    env.DB.prepare("insert into users (id, email, full_name, role) values (?, ?, ?, ?)")
      .bind("user-admin", "admin@example.com", "Admin User", "admin"),
    env.DB.prepare("insert into users (id, email, full_name, role) values (?, ?, ?, ?)")
      .bind("user-alice", "alice@example.com", "Alice User", "user"),
    env.DB.prepare("insert into users (id, email, full_name, role) values (?, ?, ?, ?)")
      .bind("user-bob", "bob@example.com", "Bob User", "user"),
    ...contentIamCatalogStatements(),
    env.DB.prepare("insert into media (id, org_id, alt, owner, url, thumbnail_url, filename, mime_type, filesize, width, height, original_key, variant_keys_json, status, visibility, version) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, json(?), ?, ?, ?)")
      .bind(
        "media-alice",
        "org-main",
        "Alice image",
        "user-alice",
        "media/media-alice/v1/variants/medium.webp",
        "media/media-alice/v1/variants/thumb.webp",
        "alice.jpg",
        "image/jpeg",
        1234,
        100,
        100,
        "media/media-alice/v1/original",
        JSON.stringify({
          thumb: "media/media-alice/v1/variants/thumb.webp",
          medium: "media/media-alice/v1/variants/medium.webp",
          og: "media/media-alice/v1/variants/og.jpg",
        }),
        "ready",
        "private",
        1,
      ),
    env.DB.prepare("insert into categories (id, org_id, name, slug, description, image, created_by) values (?, ?, ?, ?, ?, ?, ?)")
      .bind("cat-alice", "org-main", "Alice Category", "alice-category", "Owned by Alice", "media-alice", "user-alice"),
    env.DB.prepare("insert into posts (id, org_id, title, slug, excerpt, content_json, author, category, status, published_at) values (?, ?, ?, ?, ?, json(?), ?, ?, ?, ?)")
      .bind("post-draft", "org-main", "Draft Post", "draft-post", "Draft excerpt", '{"content":{"blocks":[]},"tags":["draft"]}', "user-alice", "cat-alice", "draft", null),
    env.DB.prepare("insert into posts (id, org_id, title, slug, excerpt, content_json, author, category, status, published_at) values (?, ?, ?, ?, ?, json(?), ?, ?, ?, ?)")
      .bind("post-published", "org-main", "Published Post", "published-post", "Published excerpt", '{"content":{"blocks":[]},"tags":["public"]}', "user-alice", "cat-alice", "published", 1715900000000),
    env.DB.prepare("insert into books (id, org_id, title, created_by_user_id, visibility, status) values (?, ?, ?, ?, ?, ?)")
      .bind("book-main", "org-main", "Shared Book", "user-alice", "private", "draft"),
    env.DB.prepare("insert into content_policy_bindings (id, org_id, principal_type, principal_id, role_id, resource_type, resource_id, created_by_type, created_by_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("binding-org-author-alice", "org-main", "user", "user-alice", "system:org.author", "org", "org-main", "user", "user-admin"),
    env.DB.prepare("insert into content_policy_bindings (id, org_id, principal_type, principal_id, role_id, resource_type, resource_id, created_by_type, created_by_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("binding-post-draft-owner", "org-main", "user", "user-alice", "system:post.owner", "post", "post-draft", "user", "user-alice"),
    env.DB.prepare("insert into content_policy_bindings (id, org_id, principal_type, principal_id, role_id, resource_type, resource_id, created_by_type, created_by_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("binding-post-published-owner", "org-main", "user", "user-alice", "system:post.owner", "post", "post-published", "user", "user-alice"),
    env.DB.prepare("insert into content_policy_bindings (id, org_id, principal_type, principal_id, role_id, resource_type, resource_id, created_by_type, created_by_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("binding-media-owner", "org-main", "user", "user-alice", "system:media.owner", "media", "media-alice", "user", "user-alice"),
  ]);

  // R2 objects for media-alice never change between tests and are never deleted
  // by any test, so we only need to put them once for the whole session.
  if (!r2Seeded) {
    r2Seeded = true;
    await Promise.all([
      dbBatch,
      env.MEDIA_R2.put("media/media-alice/v1/variants/thumb.webp", "thumb-image", {
        httpMetadata: { contentType: "image/webp" },
      }),
      env.MEDIA_R2.put("media/media-alice/v1/variants/medium.webp", "medium-image", {
        httpMetadata: { contentType: "image/webp" },
      }),
      env.MEDIA_R2.put("media/media-alice/v1/variants/og.jpg", "og-image", {
        httpMetadata: { contentType: "image/jpeg" },
      }),
    ]);
  } else {
    await dbBatch;
  }
}

export async function request(
  path: string,
  init: RequestInit & { token?: string } = {},
) {
  const headers = new Headers(init.headers);
  if (init.token) {
    headers.set("authorization", `Bearer ${init.token}`);
  }
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const req = new Request(`http://localhost/api${path}`, { ...init, headers });
  const ctx = createExecutionContext();
  const res = await app.fetch(
    req,
    {
      ...env,
      AUTH_ISSUER,
      AUTH_AUDIENCE,
      AUTH_JWKS_URL,
      AUTH_REQUIRED_SCOPE: "content:read content:write content:share",
      ID_SCIM_URL,
      ID_SCIM_TOKEN_URL,
      ID_SCIM_CLIENT_ID,
      ID_SCIM_CLIENT_SECRET,
      ID_SCIM_AUDIENCE,
      ID_SCIM_SCOPE,
    },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

export async function countRows(sql: string, ...bindings: unknown[]) {
  const row = await env.DB.prepare(sql)
    .bind(...bindings)
    .first<{ count: number | string }>();
  return Number(row?.count ?? 0);
}

// Writes the bootstrap state directly into D1, bypassing the HTTP round-trip,
// JWT verification, and SCIM directory fetch. Functionally equivalent for
// tests that just need an admin-capable token — not for tests that assert on
// the bootstrap endpoint's own HTTP behavior (those call request() directly).
export async function seedBootstrapAdmin(userId = "user-alice", orgId = "org-main") {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO content_iam_bootstrap_organizations (org_id, created_at) VALUES (?, ?)",
    ).bind(orgId, now),
    env.DB.prepare(
      "INSERT INTO content_policy_bindings (id, org_id, principal_type, principal_id, role_id, resource_type, resource_id, created_by_type, created_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(`binding-bootstrap-admin-${orgId}`, orgId, "user", userId, "system:org.content_admin", "org", orgId, "user", userId, now),
  ]);
}

export async function bootstrapContentIamAdmin() {
  await seedBootstrapAdmin();
  return issueWorkspaceShareToken("user-alice");
}

export async function seedBookOwner(userId = "user-alice") {
  await env.DB.prepare(
    "insert into content_policy_bindings (id, org_id, principal_type, principal_id, role_id, resource_type, resource_id, created_by_type, created_by_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind("binding-book-main-owner", "org-main", "user", userId, "system:book.owner", "book", "book-main", "user", userId)
    .run();
}

let migrationsApplied = false;
let keyPairInitialized = false;
let r2Seeded = false;

// Run once per test file in beforeAll.
export async function setupBeforeAll() {
  if (!keyPairInitialized) {
    const keys = await generateKeyPair("RS256");
    privateKey = keys.privateKey;
    publicJwk = await exportJWK(keys.publicKey);
    publicJwk.kid = "test-key";
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
    keyPairInitialized = true;
  }

  if (!migrationsApplied) {
    const allStatements = [
      migrationSql0000,
      migrationSql0001,
      migrationSql0002,
      migrationSql0003,
      migrationSql0004,
      migrationSql0005,
      migrationSql0006,
      migrationSql0007,
    ].flatMap((sql) =>
      sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => env.DB.prepare(s)),
    );

    await env.DB.batch(allStatements);
    migrationsApplied = true;
  }
}

// Run before each test: clears all data and re-inserts the base fixture.
export async function setupBeforeEach() {
  clearClientCredentialsTokenMemoryCache();
  scimTokenRequests = 0;
  await seed();
}
