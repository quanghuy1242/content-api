/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { createExecutionContext, env, reset, waitOnExecutionContext } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import migrationSql0000 from "../drizzle/0000_dapper_korvac.sql?raw";
import migrationSql0001 from "../drizzle/0001_unique_starhawk.sql?raw";
import migrationSql0002 from "../drizzle/0002_media_upload_flow.sql?raw";
import migrationSql0003 from "../drizzle/0003_content_iam_policy.sql?raw";
import migrationSql0004 from "../drizzle/0004_content_iam_guards.sql?raw";
import migrationSql0005 from "../drizzle/0005_remove_legacy_authz.sql?raw";
import migrationSql0006 from "../drizzle/0006_content_resources_org_scope.sql?raw";
import { BUILT_IN_CONTENT_ROLES, CONTENT_PERMISSIONS } from "@/domain/iam/content-permission";
import { createApp } from "@/main";
import { clearClientCredentialsTokenMemoryCache } from "@/infrastructure/identity/client-credentials-token-provider";

const AUTH_ISSUER = "https://id.test/api/auth";
const AUTH_AUDIENCE = "https://content-api.test";
const AUTH_JWKS_URL = "https://id.test/api/auth/jwks";
const ID_PRINCIPAL_VALIDATION_URL = "https://id.test";
const ID_PRINCIPAL_VALIDATION_TOKEN_URL = "https://id.test/api/auth/oauth2/token";
const ID_PRINCIPAL_VALIDATION_CLIENT_ID = "content-api-principal-validation";
const ID_PRINCIPAL_VALIDATION_CLIENT_SECRET = "principal-validation-secret";
const ID_PRINCIPAL_VALIDATION_AUDIENCE = "https://id.test/principal-validation";
const ID_PRINCIPAL_VALIDATION_SCOPE = "identity:principals:validate";
const ID_PRINCIPAL_VALIDATION_ACCESS_TOKEN = "principal-validation-access-token";

let privateKey: CryptoKey;
let publicJwk: JWK;
let principalValidationTokenRequests = 0;

const app = createApp({
  fetchImpl: async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === AUTH_JWKS_URL) {
      return Response.json({ keys: [publicJwk] });
    }
    if (url === ID_PRINCIPAL_VALIDATION_TOKEN_URL) {
      principalValidationTokenRequests += 1;
      const bodyText = typeof init?.body === "string"
        ? init.body
        : init?.body instanceof URLSearchParams
          ? init.body.toString()
          : "";
      const form = new URLSearchParams(bodyText);
      if (
        form.get("grant_type") !== "client_credentials" ||
        form.get("client_id") !== ID_PRINCIPAL_VALIDATION_CLIENT_ID ||
        form.get("client_secret") !== ID_PRINCIPAL_VALIDATION_CLIENT_SECRET ||
        form.get("resource") !== ID_PRINCIPAL_VALIDATION_AUDIENCE ||
        form.get("scope") !== ID_PRINCIPAL_VALIDATION_SCOPE
      ) {
        return Response.json({ error: "invalid_client" }, { status: 401 });
      }
      return Response.json({
        access_token: ID_PRINCIPAL_VALIDATION_ACCESS_TOKEN,
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    if (url.startsWith(`${ID_PRINCIPAL_VALIDATION_URL}/api/auth/principal-validation/`)) {
      if (init?.headers && new Headers(init.headers).get("authorization") !== `Bearer ${ID_PRINCIPAL_VALIDATION_ACCESS_TOKEN}`) {
        return Response.json({ valid: false }, { status: 401 });
      }
      const bodyText = typeof init?.body === "string"
        ? init.body
        : input instanceof Request
          ? await input.clone().text()
          : "{}";
      const body = JSON.parse(bodyText) as Record<string, string>;
      if (Object.values(body).some((value) => value.startsWith("missing-") || value === "wrong-org")) {
        return Response.json({ valid: false }, { status: 404 });
      }
      return Response.json({ valid: true });
    }
    return fetch(input);
  },
});

async function issueToken(subject: string, options: {
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

async function issueServiceAccountToken(options: {
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

async function seed() {
  for (const migrationSql of [
    migrationSql0000,
    migrationSql0001,
    migrationSql0002,
    migrationSql0003,
    migrationSql0004,
    migrationSql0005,
    migrationSql0006,
  ]) {
    for (const statement of migrationSql
      .split("--> statement-breakpoint")
      .map((statementText) => statementText.trim())
      .filter(Boolean)) {
      await env.DB.prepare(statement).run();
    }
  }

  await env.DB.batch([
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
      .bind("binding-category-owner", "org-main", "user", "user-alice", "system:category.owner", "category", "cat-alice", "user", "user-alice"),
    env.DB.prepare("insert into content_policy_bindings (id, org_id, principal_type, principal_id, role_id, resource_type, resource_id, created_by_type, created_by_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("binding-media-owner", "org-main", "user", "user-alice", "system:media.owner", "media", "media-alice", "user", "user-alice"),
  ]);

  await env.MEDIA_R2.put("media/media-alice/v1/variants/thumb.webp", "thumb-image", {
    httpMetadata: { contentType: "image/webp" },
  });
  await env.MEDIA_R2.put("media/media-alice/v1/variants/medium.webp", "medium-image", {
    httpMetadata: { contentType: "image/webp" },
  });
  await env.MEDIA_R2.put("media/media-alice/v1/variants/og.jpg", "og-image", {
    httpMetadata: { contentType: "image/jpeg" },
  });
}

async function request(
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

  const req = new Request(`http://localhost${path}`, {
    ...init,
    headers,
  });
  const ctx = createExecutionContext();
  const res = await app.fetch(
    req,
    {
      ...env,
      AUTH_ISSUER,
      AUTH_AUDIENCE,
      AUTH_JWKS_URL,
      AUTH_REQUIRED_SCOPE: "content:read content:write content:share",
      ID_PRINCIPAL_VALIDATION_URL,
      ID_PRINCIPAL_VALIDATION_TOKEN_URL,
      ID_PRINCIPAL_VALIDATION_CLIENT_ID,
      ID_PRINCIPAL_VALIDATION_CLIENT_SECRET,
      ID_PRINCIPAL_VALIDATION_AUDIENCE,
      ID_PRINCIPAL_VALIDATION_SCOPE,
    },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function countRows(sql: string, ...bindings: unknown[]) {
  const row = await env.DB.prepare(sql)
    .bind(...bindings)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
}

function contentIamCatalogStatements() {
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

async function issueWorkspaceShareToken(subject = "user-alice") {
  return issueToken(subject, {
    orgId: "org-main",
    teamIds: ["team-authors"],
    scope: "content:read content:write content:share",
  });
}

async function bootstrapContentIamAdmin() {
  const token = await issueWorkspaceShareToken("user-alice");
  const res = await request("/organizations/org-main/content-iam/bootstrap", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ userId: "user-alice", reason: "test bootstrap" }),
  });
  expect(res.status).toBe(201);
  return token;
}

async function seedBookOwner(userId = "user-alice") {
  await env.DB.prepare(
    "insert into content_policy_bindings (id, org_id, principal_type, principal_id, role_id, resource_type, resource_id, created_by_type, created_by_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "binding-book-main-owner",
      "org-main",
      "user",
      userId,
      "system:book.owner",
      "book",
      "book-main",
      "user",
      userId,
    )
    .run();
}

beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  publicJwk = await exportJWK(keys.publicKey);
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
});

beforeEach(async () => {
  await reset();
  clearClientCredentialsTokenMemoryCache();
  principalValidationTokenRequests = 0;
  await seed();
});

it("returns 401 for unauthenticated protected routes", async () => {
  const res = await request("/users");
  expect(res.status).toBe(401);
  await expect(res.json()).resolves.toMatchObject({
    error: { code: "UNAUTHORIZED" },
  });
});

it("returns 401 for invalid bearer tokens", async () => {
  const res = await request("/users", { token: "not-a-jwt" });
  expect(res.status).toBe(401);
  await expect(res.json()).resolves.toMatchObject({
    error: { code: "UNAUTHORIZED", message: "Invalid token" },
  });
});

it("rejects id tokens with the wrong audience or no accepted content scope", async () => {
  const wrongAudience = await issueToken("user-alice", { audience: "https://other-api.test" });
  const wrongAudienceRes = await request("/users", { token: wrongAudience });
  expect(wrongAudienceRes.status).toBe(401);

  const missingScope = await issueToken("user-alice", { scope: "org:read" });
  const missingScopeRes = await request("/users", { token: missingScope });
  expect(missingScopeRes.status).toBe(401);
});

it("accepts direct-share user tokens and rejects direct-share content:share", async () => {
  const directShare = await issueToken("user-alice", { scope: "content:read content:write" });
  const directShareRes = await request("/users/user-alice", { token: directShare });
  expect(directShareRes.status).toBe(200);

  const invalidShare = await issueToken("user-alice", { scope: "content:read content:share" });
  const invalidShareRes = await request("/users/user-alice", { token: invalidShare });
  expect(invalidShareRes.status).toBe(401);
});

it("enforces route-level read and write OAuth scopes", async () => {
  const readOnly = await issueToken("user-alice", { scope: "content:read" });
  const writeDenied = await request("/posts/post-draft/publish", {
    method: "POST",
    token: readOnly,
  });
  expect(writeDenied.status).toBe(403);

  const writeOnly = await issueToken("user-alice", { orgId: "org-main", scope: "content:write" });
  const createRes = await request("/media", {
    method: "POST",
    token: writeOnly,
    body: JSON.stringify({
      alt: "Write-only upload",
      filename: "write-only.png",
      mimeType: "image/png",
      filesize: 2048,
    }),
  });
  expect(createRes.status).toBe(201);

  const privateReadRes = await request("/media/media-alice", { token: writeOnly });
  expect(privateReadRes.status).toBe(403);
});

it("accepts id service-account tokens without granting implicit user administration", async () => {
  const token = await issueServiceAccountToken();
  const res = await request("/users", { token });
  expect(res.status).toBe(403);
});

it("serves an OpenAPI document for the registered API routes", async () => {
  const res = await request("/openapi.json");
  expect(res.status).toBe(200);

  const body = await res.json() as {
    openapi: string;
    components?: { securitySchemes?: Record<string, unknown> };
    paths: Record<string, unknown>;
  };

  expect(body.openapi).toBe("3.0.0");
  expect(Object.keys(body.paths)).toEqual(
    expect.arrayContaining([
      "/users",
      "/categories",
      "/posts",
      "/posts/{id}/publish",
      "/media",
      "/books",
      "/books/{id}",
      "/organizations/{orgId}/books",
      "/books/{bookId}/policy-bindings",
      "/books/{bookId}/policy-denials",
      "/books/{bookId}/ownership-transfer",
      "/organizations/{orgId}/content-roles",
      "/organizations/{orgId}/content-admins",
    ]),
  );
  expect(body.paths).not.toHaveProperty("/grant-mirror");
  expect(body.paths).not.toHaveProperty("/deferred-grants");
  expect(body.paths).not.toHaveProperty("/relationships");
  expect(body.components?.securitySchemes).toHaveProperty("Bearer");
  const postsCreate = body.paths["/posts"] as { post?: { parameters?: Array<{ name?: string; in?: string }> } };
  expect(postsCreate.post?.parameters).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "idempotency-key", in: "header" })]),
  );
});

it("creates a book with its owner binding atomically and replays the result idempotently", async () => {
  const token = await bootstrapContentIamAdmin();
  const key = crypto.randomUUID();
  const first = await request("/organizations/org-main/books", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify({ title: "Atomic Book" }),
  });
  expect(first.status).toBe(201);
  const firstBody = await first.json() as { data: { id: string; createdByUserId: string } };
  expect(firstBody.data.createdByUserId).toBe("user-alice");

  const replay = await request("/organizations/org-main/books", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify({ title: "Atomic Book" }),
  });
  expect(replay.status).toBe(201);
  await expect(replay.json()).resolves.toMatchObject({ data: { id: firstBody.data.id } });
  expect(await countRows("select count(*) as count from books where id = ?", firstBody.data.id)).toBe(1);
  expect(await countRows(
    "select count(*) as count from content_policy_bindings where role_id = ? and resource_id = ? and principal_id = ?",
    "system:book.owner",
    firstBody.data.id,
    "user-alice",
  )).toBe(1);
  expect(await countRows(
    "select count(*) as count from content_policy_events where action = ? and target_id = ?",
    "binding.created",
    firstBody.data.id,
  )).toBe(1);

  const mismatch = await request("/organizations/org-main/books", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify({ title: "Changed Input" }),
  });
  expect(mismatch.status).toBe(409);
});

it("allows an organization author to create a privately owned draft book", async () => {
  const adminToken = await bootstrapContentIamAdmin();
  const authorGrant = await request("/organizations/org-main/policy-bindings", {
    method: "POST",
    token: adminToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:org.author",
    }),
  });
  expect(authorGrant.status).toBe(201);
  const authorToken = await issueWorkspaceShareToken("user-bob");
  const created = await request("/organizations/org-main/books", {
    method: "POST",
    token: authorToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ title: "Authored Book" }),
  });
  expect(created.status).toBe(201);
  await expect(created.json()).resolves.toMatchObject({
    data: {
      createdByUserId: "user-bob",
      visibility: "private",
      status: "draft",
    },
  });
});

it("commits only one owned book for concurrent identical idempotent creates", async () => {
  const token = await bootstrapContentIamAdmin();
  const key = crypto.randomUUID();
  const responses = await Promise.all([
    request("/organizations/org-main/books", {
      method: "POST",
      token,
      headers: { "idempotency-key": key },
      body: JSON.stringify({ title: "Concurrent Book" }),
    }),
    request("/organizations/org-main/books", {
      method: "POST",
      token,
      headers: { "idempotency-key": key },
      body: JSON.stringify({ title: "Concurrent Book" }),
    }),
  ]);
  expect(responses.every((response) => response.status === 201)).toBe(true);
  const bodies = await Promise.all(responses.map((response) => response.json() as Promise<{ data: { id: string } }>));
  expect(bodies[0].data.id).toBe(bodies[1].data.id);
  expect(await countRows("select count(*) as count from books where title = ?", "Concurrent Book")).toBe(1);
  expect(await countRows(
    "select count(*) as count from content_policy_bindings where role_id = ? and resource_id = ?",
    "system:book.owner",
    bodies[0].data.id,
  )).toBe(1);
});

it("rejects direct-share creation of an organization-root book", async () => {
  const directShare = await issueToken("user-alice", { scope: "content:write" });
  const directShareCreate = await request("/organizations/org-main/books", {
    method: "POST",
    token: directShare,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ title: "Outside Workspace" }),
  });
  expect(directShareCreate.status).toBe(403);
});

it("requires an explicit direct owner for authorized service-account book creation", async () => {
  const adminToken = await bootstrapContentIamAdmin();
  const grantImporter = await request("/organizations/org-main/policy-bindings", {
    method: "POST",
    token: adminToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "service_account", id: "client-content-bot" },
      roleId: "system:org.author",
    }),
  });
  expect(grantImporter.status).toBe(201);

  const importer = await issueServiceAccountToken({ scope: "content:write" });
  const missingOwner = await request("/organizations/org-main/books", {
    method: "POST",
    token: importer,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ title: "Ownerless Import" }),
  });
  expect(missingOwner.status).toBe(400);
  const created = await request("/organizations/org-main/books", {
    method: "POST",
    token: importer,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ title: "Imported Book", ownerUserId: "user-bob" }),
  });
  expect(created.status).toBe(201);
  const body = await created.json() as { data: { id: string; createdByUserId: string } };
  expect(body.data.createdByUserId).toBe("user-bob");
  expect(await countRows(
    "select count(*) as count from content_policy_bindings where role_id = ? and resource_id = ? and principal_id = ?",
    "system:book.owner",
    body.data.id,
    "user-bob",
  )).toBe(1);
});

it("uses Content IAM for private book reads and updates", async () => {
  const ownerToken = await bootstrapContentIamAdmin();
  const create = await request("/organizations/org-main/books", {
    method: "POST",
    token: ownerToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ title: "Collaborative Book" }),
  });
  const book = await create.json() as { data: { id: string } };

  const privateAnonymous = await request(`/books/${book.data.id}`);
  expect(privateAnonymous.status).toBe(403);
  const grantReader = await request(`/books/${book.data.id}/policy-bindings`, {
    method: "POST",
    token: ownerToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.reader",
    }),
  });
  expect(grantReader.status).toBe(201);
  const reader = await issueToken("user-bob", { scope: "content:read" });
  const privateReader = await request(`/books/${book.data.id}`, { token: reader });
  expect(privateReader.status).toBe(200);
  const readerUpdate = await request(`/books/${book.data.id}`, {
    method: "PATCH",
    token: await issueToken("user-bob", { scope: "content:write" }),
    body: JSON.stringify({ title: "Forbidden Rename" }),
  });
  expect(readerUpdate.status).toBe(403);
});

it("allows public published book reads after an authorized update", async () => {
  const ownerToken = await bootstrapContentIamAdmin();
  const create = await request("/organizations/org-main/books", {
    method: "POST",
    token: ownerToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ title: "Published Book" }),
  });
  const book = await create.json() as { data: { id: string } };
  const publish = await request(`/books/${book.data.id}`, {
    method: "PATCH",
    token: ownerToken,
    body: JSON.stringify({ visibility: "public", status: "published" }),
  });
  expect(publish.status).toBe(200);
  const publicRead = await request(`/books/${book.data.id}`);
  expect(publicRead.status).toBe(200);
  const publicList = await request("/books");
  expect(publicList.status).toBe(200);
  const listBody = await publicList.json() as { data: Array<{ id: string }> };
  expect(listBody.data.map((candidate) => candidate.id)).toContain(book.data.id);
});

it("returns 403 when a non-owner updates a protected category", async () => {
  const token = await issueToken("user-bob");
  const res = await request("/categories/cat-alice", {
    method: "PATCH",
    token,
    body: JSON.stringify({ description: "Nope" }),
  });
  expect(res.status).toBe(403);
});

it("returns 404 for missing resources", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const res = await request("/posts/missing-post", { token });
  expect(res.status).toBe(404);
});

it("reads users with field-level visibility for self", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const res = await request("/users/user-alice", { token });
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    data: {
      id: "user-alice",
      email: "user-alice@example.com",
      role: null,
      
    },
  });
});

it("fills a missing local user projection from the id subject instead of creating identity", async () => {
  const token = await issueToken("user-new", { scope: "content:read" });
  const res = await request("/users/user-new", { token });
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    data: {
      id: "user-new",
      email: "user-new@example.com",
      fullName: "user-new name",
    },
  });

  expect(await countRows("select count(*) as count from users where id = ?", "user-new")).toBe(1);
});

it("does not erase existing local identity fields when a content token omits profile claims", async () => {
  const token = await issueToken("user-alice", { scope: "content:read", includeProfile: false });
  const res = await request("/users/user-alice", { token });
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    data: {
      id: "user-alice",
      email: "alice@example.com",
      fullName: "Alice User",
    },
  });
});

it("publishes a draft post for its author", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const res = await request("/posts/post-draft/publish", {
    method: "POST",
    token,
  });
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    data: {
      id: "post-draft",
      status: "published",
    },
  });
});

it("allows anonymous reads of published posts", async () => {
  const res = await request("/posts/post-published");
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    data: {
      id: "post-published",
      status: "published",
    },
  });
});

it("lists only published posts publicly and private drafts through Content IAM", async () => {
  const publicRes = await request("/posts");
  expect(publicRes.status).toBe(200);
  const publicBody = await publicRes.json() as { data: Array<{ id: string }> };
  expect(publicBody.data.map((post) => post.id)).toEqual(["post-published"]);

  const ownerToken = await issueToken("user-alice", { scope: "content:read" });
  const ownerRes = await request("/posts", { token: ownerToken });
  expect(ownerRes.status).toBe(200);
  const ownerBody = await ownerRes.json() as { data: Array<{ id: string }> };
  expect(ownerBody.data.map((post) => post.id)).toEqual(["post-published", "post-draft"]);
});

it("allows the owner to publish media and anonymous users to read it after publish", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const publishRes = await request("/media/media-alice/publish", {
    method: "POST",
    token,
  });
  expect(publishRes.status).toBe(200);

  const getRes = await request("/media/media-alice");
  expect(getRes.status).toBe(200);
  await expect(getRes.json()).resolves.toMatchObject({
    data: {
      id: "media-alice",
      visibility: "public",
      variantUrls: {
        medium: "/media/media-alice/v/1/variants/medium",
      },
    },
  });
});

it("creates pending media upload rows and returns presigned upload instructions", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const res = await request("/media", {
    method: "POST",
    token,
    body: JSON.stringify({
      alt: "Queued upload",
      filename: "queued-upload.png",
      mimeType: "image/png",
      filesize: 2048,
    }),
  });
  expect(res.status).toBe(201);
  await expect(res.json()).resolves.toMatchObject({
    data: {
      media: {
        alt: "Queued upload",
        filename: "queued-upload.png",
        mimeType: "image/png",
        filesize: 2048,
        status: "pending_upload",
        visibility: "private",
      },
      upload: {
        method: "PUT",
        headers: {
          "Content-Type": "image/png",
        },
      },
    },
  });
});

it("does not allow pending media to be published", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const createRes = await request("/media", {
    method: "POST",
    token,
    body: JSON.stringify({
      alt: "Pending publish",
      filename: "pending-publish.png",
      mimeType: "image/png",
      filesize: 2048,
    }),
  });
  const created = await createRes.json() as { data: { media: { id: string } } };

  const publishRes = await request(`/media/${created.data.media.id}/publish`, {
    method: "POST",
    token,
  });
  expect(publishRes.status).toBe(409);
});

it("does not allow anonymous reads of pending media", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const createRes = await request("/media", {
    method: "POST",
    token,
    body: JSON.stringify({
      alt: "Pending anonymous read",
      filename: "pending-anon.png",
      mimeType: "image/png",
      filesize: 2048,
    }),
  });
  const created = await createRes.json() as { data: { media: { id: string } } };

  const getRes = await request(`/media/${created.data.media.id}`);
  expect(getRes.status).toBe(403);
});

it("streams a stored media variant through the API worker", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const publishRes = await request("/media/media-alice/publish", {
    method: "POST",
    token,
  });
  expect(publishRes.status).toBe(200);

  const variantRes = await request("/media/media-alice/v/1/variants/medium");
  expect(variantRes.status).toBe(200);
  expect(variantRes.headers.get("content-type")).toBe("image/webp");
  expect(variantRes.headers.get("cache-control")).toContain("public");
  const variantBody = await variantRes.arrayBuffer();
  expect(new TextDecoder().decode(variantBody)).toBe("medium-image");
});

it("does not expose legacy grant mirror, deferred grant, or relationship routes", async () => {
  const token = await issueToken("user-admin");

  for (const path of ["/grant-mirror", "/deferred-grants", "/relationships"]) {
    const getRes = await request(path, { token });
    expect(getRes.status).toBe(404);
    const postRes = await request(path, {
      method: "POST",
      token,
      body: JSON.stringify({}),
    });
    expect(postRes.status).toBe(404);
  }
});

it("uses Content IAM bindings instead of legacy relationships for posts, categories, and media", async () => {
  const alice = await issueToken("user-alice");
  const bob = await issueToken("user-bob");

  expect((await request("/posts/post-draft", { token: alice })).status).toBe(200);
  expect((await request("/posts/post-draft", { token: bob })).status).toBe(403);
  expect((await request("/media/media-alice", { token: alice })).status).toBe(200);
  expect((await request("/media/media-alice", { token: bob })).status).toBe(403);

  const categoryWrite = await request("/categories/cat-alice", {
    method: "PATCH",
    token: bob,
    body: JSON.stringify({
      description: "Bob should not be able to update Alice category",
    }),
  });
  expect(categoryWrite.status).toBe(403);
});

it("bootstraps Content IAM, grants a book reader, records denials, and lists audit events", async () => {
  const token = await bootstrapContentIamAdmin();
  await seedBookOwner();

  const bindingRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.reader",
      reason: "reader invite",
    }),
  });
  expect(bindingRes.status).toBe(201);
  await expect(bindingRes.json()).resolves.toMatchObject({
    data: {
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.reader",
      resource: { type: "book", id: "book-main" },
    },
  });

  const denialRes = await request("/books/book-main/policy-denials", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      permission: "book.read",
      appliesToDescendants: true,
      reason: "temporary hold",
    }),
  });
  expect(denialRes.status).toBe(201);

  const eventsRes = await request("/books/book-main/policy-events", { token });
  expect(eventsRes.status).toBe(200);
  const eventsBody = await eventsRes.json() as { data: Array<{ action: string }> };
  expect(eventsBody.data.map((event) => event.action)).toEqual(
    expect.arrayContaining(["binding.created", "denial.created"]),
  );
});

it("prevents direct-share tokens and sensitive target principals from mutating Content IAM", async () => {
  const token = await bootstrapContentIamAdmin();
  await seedBookOwner();

  const directShareToken = await issueToken("user-alice", { scope: "content:read content:write" });
  const directShareRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token: directShareToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.reader",
    }),
  });
  expect(directShareRes.status).toBe(403);

  const teamManagerRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "team", id: "team-authors" },
      roleId: "system:book.sharing_manager",
    }),
  });
  expect(teamManagerRes.status).toBe(400);

  const ownerGrantRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.owner",
    }),
  });
  expect(ownerGrantRes.status).toBe(400);
});

it("audits workspace self-escalation without creating authority and rejects M2M sensitive targets", async () => {
  const token = await bootstrapContentIamAdmin();
  const unauthorizedToken = await issueWorkspaceShareToken("user-bob");
  const selfGrantRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token: unauthorizedToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.sharing_manager",
    }),
  });
  expect(selfGrantRes.status).toBe(403);
  expect(await countRows(
    "select count(*) as count from content_policy_bindings where principal_id = ? and role_id = ? and resource_id = ?",
    "user-bob",
    "system:book.sharing_manager",
    "book-main",
  )).toBe(0);
  expect(await countRows(
    "select count(*) as count from content_policy_events where action = ? and actor_id = ? and target_id = ?",
    "policy.mutation_denied",
    "user-bob",
    "book-main",
  )).toBe(1);

  const serviceManagementRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "service_account", id: "client-content-bot" },
      roleId: "system:book.sharing_manager",
    }),
  });
  expect(serviceManagementRes.status).toBe(400);
});

it("allows organization authors to be delegated through ordinary org bindings", async () => {
  const token = await bootstrapContentIamAdmin();
  const res = await request("/organizations/org-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:org.author",
      reason: "author delegation",
    }),
  });
  expect(res.status).toBe(201);
  await expect(res.json()).resolves.toMatchObject({
    data: {
      principal: { type: "user", id: "user-bob" },
      roleId: "system:org.author",
      resource: { type: "org", id: "org-main" },
    },
  });
});

it("permits validated ordinary external and service-account book bindings but rejects workspace mismatch", async () => {
  const token = await bootstrapContentIamAdmin();
  const externalRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "external-reader" },
      roleId: "system:book.reader",
    }),
  });
  expect(externalRes.status).toBe(201);

  const serviceRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "service_account", id: "client-content-bot" },
      roleId: "system:book.reader",
    }),
  });
  expect(serviceRes.status).toBe(201);

  const mismatchedToken = await issueToken("user-alice", {
    orgId: "org-other",
    scope: "content:read content:write content:share",
  });
  const mismatchRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token: mismatchedToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.reader",
    }),
  });
  expect(mismatchRes.status).toBe(403);
});

it("shows inherited organization bindings only in the effective book binding view", async () => {
  const token = await bootstrapContentIamAdmin();
  const directRes = await request("/books/book-main/policy-bindings?view=direct", { token });
  expect(directRes.status).toBe(200);
  const directBody = await directRes.json() as { data: Array<{ roleId: string }> };
  expect(directBody.data).toEqual([]);

  const effectiveRes = await request("/books/book-main/policy-bindings?view=effective", { token });
  expect(effectiveRes.status).toBe(200);
  const effectiveBody = await effectiveRes.json() as { data: Array<{ roleId: string; resource: { type: string; id: string } }> };
  expect(effectiveBody.data).toEqual(expect.arrayContaining([
    expect.objectContaining({
      roleId: "system:org.content_admin",
      resource: { type: "org", id: "org-main" },
    }),
  ]));
});

it("transfers book ownership atomically and rejects stale ownership transfers", async () => {
  const token = await bootstrapContentIamAdmin();
  await seedBookOwner();

  const transferRes = await request("/books/book-main/ownership-transfer", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      expectedCurrentOwnerUserId: "user-alice",
      nextOwnerUserId: "user-bob",
      reason: "handoff",
    }),
  });
  expect(transferRes.status).toBe(201);
  await expect(transferRes.json()).resolves.toMatchObject({
    nextOwner: {
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.owner",
    },
  });

  const staleRes = await request("/books/book-main/ownership-transfer", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      expectedCurrentOwnerUserId: "user-alice",
      nextOwnerUserId: "user-admin",
    }),
  });
  expect(staleRes.status).toBe(409);

  expect(await countRows(
    "select count(*) as count from content_policy_bindings where resource_type = ? and resource_id = ? and role_id = ?",
    "book",
    "book-main",
    "system:book.owner",
  )).toBe(1);
});

it("allows only one competing book ownership transfer to commit", async () => {
  const token = await bootstrapContentIamAdmin();
  await seedBookOwner();

  const transfers = await Promise.all([
    request("/books/book-main/ownership-transfer", {
      method: "POST",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        expectedCurrentOwnerUserId: "user-alice",
        nextOwnerUserId: "user-bob",
      }),
    }),
    request("/books/book-main/ownership-transfer", {
      method: "POST",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        expectedCurrentOwnerUserId: "user-alice",
        nextOwnerUserId: "user-admin",
      }),
    }),
  ]);

  expect(transfers.filter((result) => result.status === 201)).toHaveLength(1);
  expect(transfers.filter((result) => result.status === 409)).toHaveLength(1);
  expect(await countRows(
    "select count(*) as count from content_policy_bindings where resource_type = ? and resource_id = ? and role_id = ?",
    "book",
    "book-main",
    "system:book.owner",
  )).toBe(1);
});

it("manages ordinary organization-defined roles and rejects sensitive custom role composition", async () => {
  const token = await bootstrapContentIamAdmin();
  const createRes = await request("/organizations/org-main/content-roles", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      key: "commenter",
      name: "Commenter",
      assignableResourceType: "book",
      permissions: ["book.read", "comment.create"],
      reason: "test role",
    }),
  });
  expect(createRes.status).toBe(201);
  const created = await createRes.json() as { data: { id: string; version: number } };

  const updateRes = await request(`/organizations/org-main/content-roles/${created.data.id}/permissions`, {
    method: "PUT",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      expectedVersion: created.data.version,
      permissions: ["book.read", "comment.create", "inline_comment.create"],
    }),
  });
  expect(updateRes.status).toBe(201);

  const sensitiveRes = await request("/organizations/org-main/content-roles", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      key: "sensitive",
      name: "Sensitive",
      assignableResourceType: "book",
      permissions: ["book.read", "book.manage_bindings"],
    }),
  });
  expect(sensitiveRes.status).toBe(400);

  const eventsRes = await request("/organizations/org-main/policy-events", { token });
  expect(eventsRes.status).toBe(200);
  const events = await eventsRes.json() as { data: Array<{ action: string }> };
  expect(events.data.map((event) => event.action)).toContain("policy.mutation_denied");
});

it("rejects disabling roles with active bindings", async () => {
  const token = await bootstrapContentIamAdmin();
  const createRes = await request("/organizations/org-main/content-roles", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      key: "lifecycle-reader",
      name: "Lifecycle Reader",
      assignableResourceType: "book",
      permissions: ["book.read"],
    }),
  });
  const created = await createRes.json() as { data: { id: string } };
  const bindRoleRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: created.data.id,
    }),
  });
  expect(bindRoleRes.status).toBe(201);
  const boundRole = await bindRoleRes.json() as { data: { id: string } };

  const activeDisableRes = await request(`/organizations/org-main/content-roles/${created.data.id}`, {
    method: "DELETE",
    token,
  });
  expect(activeDisableRes.status).toBe(400);
  expect(boundRole.data.id).toBeTruthy();
});

it("rejects assigning disabled roles", async () => {
  const token = await bootstrapContentIamAdmin();
  const createRes = await request("/organizations/org-main/content-roles", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      key: "disabled-reader",
      name: "Disabled Reader",
      assignableResourceType: "book",
      permissions: ["book.read"],
    }),
  });
  const created = await createRes.json() as { data: { id: string } };
  const disableRes = await request(`/organizations/org-main/content-roles/${created.data.id}`, {
    method: "DELETE",
    token,
  });
  expect(disableRes.status).toBe(204);

  const disabledBindRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: created.data.id,
    }),
  });
  expect(disabledBindRes.status).toBe(400);
});

it("returns 400 when Content IAM principal validation fails for durable writes", async () => {
  const token = await bootstrapContentIamAdmin();
  await seedBookOwner();

  const missingUserRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "missing-user" },
      roleId: "system:book.reader",
    }),
  });
  expect(missingUserRes.status).toBe(400);

  const missingTeamRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "team", id: "missing-team" },
      roleId: "system:book.reader",
    }),
  });
  expect(missingTeamRes.status).toBe(400);

  const wrongOrgTeamRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "team", id: "wrong-org" },
      roleId: "system:book.reader",
    }),
  });
  expect(wrongOrgTeamRes.status).toBe(400);
});

it("uses M2M client credentials for principal validation and caches the token", async () => {
  const token = await bootstrapContentIamAdmin();
  await seedBookOwner();

  const bindingRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.reader",
    }),
  });
  expect(bindingRes.status).toBe(201);

  const denialRes = await request("/books/book-main/policy-denials", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      permission: "book.read",
      appliesToDescendants: true,
      reason: "test denial",
    }),
  });
  expect(denialRes.status).toBe(201);
  expect(principalValidationTokenRequests).toBe(1);
});

it("rejects bootstrap after a local organization Content IAM admin exists", async () => {
  const token = await bootstrapContentIamAdmin();
  const res = await request("/organizations/org-main/content-iam/bootstrap", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ userId: "user-alice", reason: "second bootstrap" }),
  });
  expect(res.status).toBe(403);
});

it("does not replay Content IAM idempotency across different resource path params", async () => {
  const token = await bootstrapContentIamAdmin();
  const key = crypto.randomUUID();
  await env.DB.prepare("insert into books (id, org_id, title, created_by_user_id, visibility, status) values (?, ?, ?, ?, ?, ?)")
    .bind("book-other", "org-main", "Other Book", "user-alice", "private", "draft")
    .run();

  const body = {
    principal: { type: "user", id: "user-bob" },
    roleId: "system:book.reader",
  };
  const first = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  });
  expect(first.status).toBe(201);

  const second = await request("/books/book-other/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  });
  expect(second.status).toBe(409);
});

it("replays identical Content IAM mutations once and rejects mismatched idempotency reuse", async () => {
  const token = await bootstrapContentIamAdmin();
  const key = crypto.randomUUID();
  const body = {
    principal: { type: "user", id: "external-idempotent-reader" },
    roleId: "system:book.reader",
  };
  const first = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  });
  const second = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  });
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  await expect(second.json()).resolves.toEqual(await first.json());
  expect(await countRows(
    "select count(*) as count from content_policy_bindings where principal_id = ? and resource_id = ?",
    "external-idempotent-reader",
    "book-main",
  )).toBe(1);

  const mismatch = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify({ ...body, roleId: "system:book.reviewer" }),
  });
  expect(mismatch.status).toBe(409);
});

it("allows exactly one concurrent duplicate binding create to commit", async () => {
  const token = await bootstrapContentIamAdmin();
  const body = JSON.stringify({
    principal: { type: "user", id: "external-race-reader" },
    roleId: "system:book.reader",
  });
  const creates = await Promise.all([
    request("/books/book-main/policy-bindings", {
      method: "POST",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body,
    }),
    request("/books/book-main/policy-bindings", {
      method: "POST",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body,
    }),
  ]);
  expect(creates.filter((result) => result.status === 201)).toHaveLength(1);
  expect(creates.filter((result) => result.status === 409)).toHaveLength(1);
});

it("requires organization membership for sensitive direct-user Content IAM targets", async () => {
  const token = await bootstrapContentIamAdmin();

  const sharingManagerRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "wrong-org" },
      roleId: "system:book.sharing_manager",
    }),
  });
  expect(sharingManagerRes.status).toBe(400);

  await seedBookOwner();
  const ownershipRes = await request("/books/book-main/ownership-transfer", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      expectedCurrentOwnerUserId: "user-alice",
      nextOwnerUserId: "wrong-org",
    }),
  });
  expect(ownershipRes.status).toBe(400);
});

it("does not allow book denial rules to remove owner or organization-admin recovery authority", async () => {
  const token = await bootstrapContentIamAdmin();
  await seedBookOwner();
  const ownerDenial = await request("/books/book-main/policy-denials", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-alice" },
      permission: "book.read",
      appliesToDescendants: true,
      reason: "not allowed",
    }),
  });
  expect(ownerDenial.status).toBe(400);
});

it("prevents sharing managers from delegating or revoking protected sharing-manager authority", async () => {
  const adminToken = await bootstrapContentIamAdmin();
  const createManager = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token: adminToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.sharing_manager",
    }),
  });
  expect(createManager.status).toBe(201);
  const manager = await createManager.json() as { data: { id: string } };
  const managerToken = await issueWorkspaceShareToken("user-bob");

  const ordinaryGrant = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token: managerToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-admin" },
      roleId: "system:book.reader",
    }),
  });
  expect(ordinaryGrant.status).toBe(201);

  const protectedGrant = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token: managerToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-admin" },
      roleId: "system:book.sharing_manager",
    }),
  });
  expect(protectedGrant.status).toBe(403);

  const protectedRevoke = await request(`/books/book-main/policy-bindings/${manager.data.id}`, {
    method: "DELETE",
    token: managerToken,
  });
  expect(protectedRevoke.status).toBe(403);
});

it("rejects cross-organization use of tenant-owned content roles", async () => {
  const orgMainToken = await bootstrapContentIamAdmin();
  const createRole = await request("/organizations/org-main/content-roles", {
    method: "POST",
    token: orgMainToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      key: "tenant-reader",
      name: "Tenant Reader",
      assignableResourceType: "book",
      permissions: ["book.read"],
    }),
  });
  expect(createRole.status).toBe(201);
  const role = await createRole.json() as { data: { id: string } };

  await env.DB.prepare("insert into books (id, org_id, title, created_by_user_id, visibility, status) values (?, ?, ?, ?, ?, ?)")
    .bind("book-other-org", "org-other", "Other Organization Book", "user-bob", "private", "draft")
    .run();
  const otherToken = await issueToken("user-bob", {
    orgId: "org-other",
    scope: "content:read content:write content:share",
  });
  const bootstrapOther = await request("/organizations/org-other/content-iam/bootstrap", {
    method: "POST",
    token: otherToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ userId: "user-bob" }),
  });
  expect(bootstrapOther.status).toBe(201);

  const bindForeignRole = await request("/books/book-other-org/policy-bindings", {
    method: "POST",
    token: otherToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: role.data.id,
    }),
  });
  expect(bindForeignRole.status).toBe(404);
});

it("requires the dedicated route and preserves the final organization Content IAM administrator", async () => {
  const token = await bootstrapContentIamAdmin();
  const row = await env.DB.prepare(
    "select id from content_policy_bindings where role_id = ? and resource_type = ? and resource_id = ?",
  )
    .bind("system:org.content_admin", "org", "org-main")
    .first<{ id: string }>();
  expect(row?.id).toBeTruthy();

  const res = await request(`/organizations/org-main/policy-bindings/${row!.id}`, {
    method: "DELETE",
    token,
  });
  expect(res.status).toBe(400);

  const dedicatedRes = await request(`/organizations/org-main/content-admins/${row!.id}`, {
    method: "DELETE",
    token,
  });
  expect(dedicatedRes.status).toBe(400);
});

it("enforces organization bootstrap and final-admin invariants under competing requests", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const bootstrapResults = await Promise.all([
    request("/organizations/org-main/content-iam/bootstrap", {
      method: "POST",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ userId: "user-alice" }),
    }),
    request("/organizations/org-main/content-iam/bootstrap", {
      method: "POST",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ userId: "user-alice" }),
    }),
  ]);
  expect(bootstrapResults.filter((result) => result.status === 201)).toHaveLength(1);
  expect([403, 409]).toContain(bootstrapResults.find((result) => result.status !== 201)?.status);
  expect(await countRows("select count(*) as count from content_iam_bootstrap_organizations where org_id = ?", "org-main")).toBe(1);
  expect(await countRows("select count(*) as count from content_policy_bindings where role_id = ? and resource_id = ?", "system:org.content_admin", "org-main")).toBe(1);

  const delegate = await request("/organizations/org-main/content-admins", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ userId: "user-bob" }),
  });
  expect(delegate.status).toBe(201);
  const delegateBody = await delegate.json() as { data: { id: string } };
  const aliceBinding = await env.DB.prepare(
    "select id from content_policy_bindings where role_id = ? and resource_id = ? and principal_id = ?",
  )
    .bind("system:org.content_admin", "org-main", "user-alice")
    .first<{ id: string }>();
  expect(aliceBinding?.id).toBeTruthy();

  const revokes = await Promise.all([
    request(`/organizations/org-main/content-admins/${aliceBinding!.id}`, { method: "DELETE", token }),
    request(`/organizations/org-main/content-admins/${delegateBody.data.id}`, { method: "DELETE", token }),
  ]);
  expect(revokes.filter((result) => result.status === 204)).toHaveLength(1);
  expect(await countRows("select count(*) as count from content_policy_bindings where role_id = ? and resource_id = ?", "system:org.content_admin", "org-main")).toBe(1);
});

it("rejects stale concurrent role replacements at the write boundary", async () => {
  const token = await bootstrapContentIamAdmin();
  const createRes = await request("/organizations/org-main/content-roles", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      key: "racing-reader",
      name: "Racing Reader",
      assignableResourceType: "book",
      permissions: ["book.read"],
    }),
  });
  const created = await createRes.json() as { data: { id: string; version: number } };
  const replacements = await Promise.all([
    request(`/organizations/org-main/content-roles/${created.data.id}/permissions`, {
      method: "PUT",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ expectedVersion: created.data.version, permissions: ["book.read", "comment.create"] }),
    }),
    request(`/organizations/org-main/content-roles/${created.data.id}/permissions`, {
      method: "PUT",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ expectedVersion: created.data.version, permissions: ["book.read", "inline_comment.create"] }),
    }),
  ]);
  expect(replacements.filter((result) => result.status === 201)).toHaveLength(1);
  expect(replacements.filter((result) => result.status === 409)).toHaveLength(1);
});

it("preserves role lifecycle consistency during competing bind and disable requests", async () => {
  const token = await bootstrapContentIamAdmin();
  const createRes = await request("/organizations/org-main/content-roles", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      key: "racing-disable",
      name: "Racing Disable",
      assignableResourceType: "book",
      permissions: ["book.read"],
    }),
  });
  expect(createRes.status).toBe(201);
  const role = await createRes.json() as { data: { id: string } };

  const [bindResult, disableResult] = await Promise.all([
    request("/books/book-main/policy-bindings", {
      method: "POST",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        principal: { type: "user", id: "user-bob" },
        roleId: role.data.id,
      }),
    }),
    request(`/organizations/org-main/content-roles/${role.data.id}`, {
      method: "DELETE",
      token,
    }),
  ]);

  expect([bindResult, disableResult].filter((result) => result.status >= 200 && result.status < 300)).toHaveLength(1);
  expect([bindResult, disableResult].filter((result) => result.status === 400)).toHaveLength(1);
  const bindings = await countRows("select count(*) as count from content_policy_bindings where role_id = ?", role.data.id);
  const disabled = await countRows("select count(*) as count from content_roles where id = ? and enabled = 0", role.data.id);
  expect(bindings + disabled).toBe(1);
});

it("rejects a sensitive upgrade to an already-defined ordinary custom role", async () => {
  const token = await bootstrapContentIamAdmin();
  const createRes = await request("/organizations/org-main/content-roles", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      key: "ordinary-bound-role",
      name: "Ordinary Bound Role",
      assignableResourceType: "book",
      permissions: ["book.read"],
    }),
  });
  const role = await createRes.json() as { data: { id: string; version: number } };
  const upgrade = await request(`/organizations/org-main/content-roles/${role.data.id}/permissions`, {
    method: "PUT",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      expectedVersion: role.data.version,
      permissions: ["book.read", "book.manage_bindings"],
    }),
  });
  expect(upgrade.status).toBe(400);
});

it("bounds denied Content IAM audit storage and prunes expired denied events", async () => {
  const token = await bootstrapContentIamAdmin();
  await env.DB.prepare(
    "insert into content_policy_events (id, org_id, target_type, target_id, action, actor_type, actor_id, reason, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind("old-denial-event", "org-main", "org", "org-main", "policy.mutation_denied", "user", "user-alice", "old", Date.now() - (91 * 24 * 60 * 60 * 1000))
    .run();

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const response = await request("/organizations/org-main/content-roles", {
      method: "POST",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        key: `blocked-${attempt}`,
        name: "Blocked Sensitive Role",
        assignableResourceType: "book",
        permissions: ["book.manage_bindings"],
      }),
    });
    expect(response.status).toBe(400);
  }

  expect(await countRows("select count(*) as count from content_policy_events where id = ?", "old-denial-event")).toBe(0);
  expect(await countRows(
    "select count(*) as count from content_policy_events where action = ? and actor_id = ? and target_id = ?",
    "policy.mutation_denied",
    "user-alice",
    "org-main",
  )).toBe(5);
}, 10_000);

it("can recreate expired Content IAM bindings after cleanup", async () => {
  const token = await bootstrapContentIamAdmin();
  await env.DB.prepare(
    "insert into content_policy_bindings (id, org_id, principal_type, principal_id, role_id, resource_type, resource_id, expires_at, created_by_type, created_by_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "expired-reader-binding",
      "org-main",
      "user",
      "user-bob",
      "system:book.reader",
      "book",
      "book-main",
      Date.now() - 60_000,
      "user",
      "user-alice",
    )
    .run();

  const res = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.reader",
    }),
  });
  expect(res.status).toBe(201);
  expect(await countRows(
    "select count(*) as count from content_policy_bindings where principal_id = ? and role_id = ? and resource_id = ?",
    "user-bob",
    "system:book.reader",
    "book-main",
  )).toBe(1);
});

it("replays post creation safely with the same idempotency key and rejects body mismatches", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const key = crypto.randomUUID();
  const body = {
    title: "Retry-safe post",
    excerpt: "first",
    content: { blocks: [{ type: "paragraph", text: "hello" }] },
    category: "cat-alice",
    tags: ["retry"],
  };

  const first = await request("/posts", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  });
  expect(first.status).toBe(201);
  const firstBody = await first.json() as { data: { id: string } };

  const second = await request("/posts", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  });
  expect(second.status).toBe(201);
  await expect(second.json()).resolves.toEqual(firstBody);

  const mismatch = await request("/posts", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify({ ...body, title: "Different title" }),
  });
  expect(mismatch.status).toBe(409);

  expect(await countRows("select count(*) as count from posts where title = ?", body.title)).toBe(1);
  expect(await countRows("select count(*) as count from idempotency_keys where key = ?", key)).toBe(1);
});

it("replays media creation safely with the same idempotency key and rejects body mismatches", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const key = crypto.randomUUID();
  const body = {
    alt: "Retry-safe media",
    filename: "retry-safe.jpg",
    mimeType: "image/jpeg",
    filesize: 4096,
  };

  const first = await request("/media", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  });
  expect(first.status).toBe(201);
  const firstBody = await first.json() as { data: { media: { id: string } } };

  const second = await request("/media", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  });
  expect(second.status).toBe(201);
  await expect(second.json()).resolves.toEqual(firstBody);

  const mismatch = await request("/media", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify({ ...body, alt: "Different alt" }),
  });
  expect(mismatch.status).toBe(409);

  expect(await countRows("select count(*) as count from media where filename = ?", body.filename)).toBe(1);
  expect(await countRows("select count(*) as count from idempotency_keys where key = ?", key)).toBe(1);
});

it("replays category creation safely with the same idempotency key and rejects body mismatches", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const key = crypto.randomUUID();
  const body = {
    name: "Retry-safe category",
    description: "retry",
    image: "media-alice",
  };

  const first = await request("/categories", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  });
  expect(first.status).toBe(201);
  const firstBody = await first.json() as { data: { id: string } };

  const second = await request("/categories", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  });
  expect(second.status).toBe(201);
  await expect(second.json()).resolves.toEqual(firstBody);

  const mismatch = await request("/categories", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify({ ...body, description: "different" }),
  });
  expect(mismatch.status).toBe(409);

  expect(await countRows("select count(*) as count from categories where name = ?", body.name)).toBe(1);
  expect(await countRows("select count(*) as count from idempotency_keys where key = ?", key)).toBe(1);
});

it("replays user creation safely with the same idempotency key and rejects body mismatches", async () => {
  const token = await issueToken("user-retry");
  const key = crypto.randomUUID();
  const body = {
    email: "ignored-retry-user@example.com",
    fullName: "Ignored Retry User",
    role: "user",
    avatar: null,
    bio: { summary: "retry" },
  };

  const first = await request("/users", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  });
  expect(first.status).toBe(201);
  const firstBody = await first.json() as { data: { id: string } };

  const second = await request("/users", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  });
  expect(second.status).toBe(201);
  await expect(second.json()).resolves.toEqual(firstBody);

  const mismatch = await request("/users", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify({ ...body, bio: { summary: "different" } }),
  });
  expect(mismatch.status).toBe(409);

  expect(firstBody.data.id).toBe("user-retry");
  expect(await countRows("select count(*) as count from users where email = ?", "user-retry@example.com")).toBe(1);
  expect(await countRows("select count(*) as count from idempotency_keys where key = ?", key)).toBe(1);
});

it("scopes idempotency keys by actor and route", async () => {
  await env.DB.prepare(
    "insert into content_policy_bindings (id, org_id, principal_type, principal_id, role_id, resource_type, resource_id, created_by_type, created_by_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind("binding-org-author-bob-scoped-key", "org-main", "user", "user-bob", "system:org.author", "org", "org-main", "user", "user-admin")
    .run();
  const aliceToken = await issueWorkspaceShareToken("user-alice");
  const bobToken = await issueWorkspaceShareToken("user-bob");
  const key = crypto.randomUUID();

  const alicePost = await request("/posts", {
    method: "POST",
    token: aliceToken,
    headers: { "idempotency-key": key },
    body: JSON.stringify({
      title: "Scoped key Alice post",
      content: { blocks: [] },
      category: "cat-alice",
    }),
  });
  expect(alicePost.status).toBe(201);

  const bobPost = await request("/posts", {
    method: "POST",
    token: bobToken,
    headers: { "idempotency-key": key },
    body: JSON.stringify({
      title: "Scoped key Bob post",
      content: { blocks: [] },
      category: "cat-alice",
    }),
  });
  expect(bobPost.status).toBe(201);

  const aliceMedia = await request("/media", {
    method: "POST",
    token: aliceToken,
    headers: { "idempotency-key": key },
    body: JSON.stringify({
      alt: "Scoped key media",
      filename: "scoped-key.jpg",
      mimeType: "image/jpeg",
      filesize: 4096,
    }),
  });
  expect(aliceMedia.status).toBe(201);

  expect(await countRows("select count(*) as count from idempotency_keys where key = ?", key)).toBe(3);
});

it("allows a scoped idempotency key to be reused after expiry", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const key = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    "insert into idempotency_keys (key, actor_id, route, request_hash, response_json, status, created_at, expires_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      key,
      "user-alice",
      "POST /posts",
      "expired-hash",
      JSON.stringify({ id: "expired-post" }),
      201,
      now - 120_000,
      now - 60_000,
    )
    .run();

  const res = await request("/posts", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify({
      title: "Expired idempotency key post",
      content: { blocks: [] },
      category: "cat-alice",
    }),
  });
  expect(res.status).toBe(201);
  await expect(res.json()).resolves.toMatchObject({
    data: { title: "Expired idempotency key post" },
  });

  expect(await countRows("select count(*) as count from idempotency_keys where key = ?", key)).toBe(1);
  expect(await countRows("select count(*) as count from posts where title = ?", "Expired idempotency key post")).toBe(1);
});

it("rolls back the idempotency row and business rows when a batched post create fails", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const key = crypto.randomUUID();

  const res = await request("/posts", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify({
      title: "Atomic failure post",
      excerpt: "should fail",
      content: { blocks: [] },
      category: "missing-category",
      tags: ["fail"],
    }),
  });
  expect(res.status).toBe(500);

  expect(await countRows("select count(*) as count from posts where title = ?", "Atomic failure post")).toBe(0);
  expect(await countRows("select count(*) as count from idempotency_keys where key = ?", key)).toBe(0);
});

it("validates idempotency headers as UUIDs", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const res = await request("/posts", {
    method: "POST",
    token,
    headers: { "idempotency-key": "not-a-uuid" },
    body: JSON.stringify({
      title: "Invalid header",
      content: { blocks: [] },
      category: "cat-alice",
    }),
  });

  expect(res.status).toBe(400);
  await expect(res.json()).resolves.toMatchObject({
    error: { code: "VALIDATION_ERROR" },
  });
});
