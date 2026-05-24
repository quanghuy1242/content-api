/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { createExecutionContext, env, reset, waitOnExecutionContext } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import migrationSql0000 from "../drizzle/0000_dapper_korvac.sql?raw";
import migrationSql0001 from "../drizzle/0001_unique_starhawk.sql?raw";
import migrationSql0002 from "../drizzle/0002_media_upload_flow.sql?raw";
import migrationSql0003 from "../drizzle/0003_content_iam_policy.sql?raw";
import { createApp } from "@/main";

const AUTH_ISSUER = "https://id.test/api/auth";
const AUTH_AUDIENCE = "https://content-api.test";
const AUTH_JWKS_URL = "https://id.test/api/auth/jwks";
const ID_PRINCIPAL_VALIDATION_URL = "https://id.test";
const ID_PRINCIPAL_VALIDATION_TOKEN = "principal-validation-token";

let privateKey: CryptoKey;
let publicJwk: JWK;

const app = createApp({
  fetchImpl: async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === AUTH_JWKS_URL) {
      return Response.json({ keys: [publicJwk] });
    }
    if (url.startsWith(`${ID_PRINCIPAL_VALIDATION_URL}/api/auth/principal-validation/`)) {
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
} = {}) {
  return new SignJWT({
    email: `${subject}@example.com`,
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
  for (const migrationSql of [migrationSql0000, migrationSql0001, migrationSql0002, migrationSql0003]) {
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
    env.DB.prepare("insert into media (id, alt, owner, url, thumbnail_url, filename, mime_type, filesize, width, height, original_key, variant_keys_json, status, visibility, version) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, json(?), ?, ?, ?)")
      .bind(
        "media-alice",
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
    env.DB.prepare("insert into categories (id, name, slug, description, image, created_by) values (?, ?, ?, ?, ?, ?)")
      .bind("cat-alice", "Alice Category", "alice-category", "Owned by Alice", "media-alice", "user-alice"),
    env.DB.prepare("insert into posts (id, title, slug, excerpt, content_json, author, category, status, published_at) values (?, ?, ?, ?, json(?), ?, ?, ?, ?)")
      .bind("post-draft", "Draft Post", "draft-post", "Draft excerpt", '{"content":{"blocks":[]},"tags":["draft"]}', "user-alice", "cat-alice", "draft", null),
    env.DB.prepare("insert into posts (id, title, slug, excerpt, content_json, author, category, status, published_at) values (?, ?, ?, ?, json(?), ?, ?, ?, ?)")
      .bind("post-published", "Published Post", "published-post", "Published excerpt", '{"content":{"blocks":[]},"tags":["public"]}', "user-alice", "cat-alice", "published", 1715900000000),
    env.DB.prepare("insert into relationships (id, subject_type, subject_id, relation, object_type, object_id) values (?, ?, ?, ?, ?, ?)")
      .bind("rel-media-owner", "user", "user-alice", "owner", "media", "media-alice"),
    env.DB.prepare("insert into relationships (id, subject_type, subject_id, relation, object_type, object_id) values (?, ?, ?, ?, ?, ?)")
      .bind("rel-cat-owner", "user", "user-alice", "owner", "category", "cat-alice"),
    env.DB.prepare("insert into relationships (id, subject_type, subject_id, relation, object_type, object_id) values (?, ?, ?, ?, ?, ?)")
      .bind("rel-post-draft-author", "user", "user-alice", "author", "post", "post-draft"),
    env.DB.prepare("insert into relationships (id, subject_type, subject_id, relation, object_type, object_id) values (?, ?, ?, ?, ?, ?)")
      .bind("rel-post-published-author", "user", "user-alice", "author", "post", "post-published"),
    env.DB.prepare("insert into books (id, org_id, title, created_by_user_id, visibility, status) values (?, ?, ?, ?, ?, ?)")
      .bind("book-main", "org-main", "Shared Book", "user-alice", "private", "draft"),
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
      AUTH_REQUIRED_SCOPE: "content:read",
      ID_PRINCIPAL_VALIDATION_URL,
      ID_PRINCIPAL_VALIDATION_TOKEN,
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

it("rejects id tokens with the wrong audience or missing required scope", async () => {
  const wrongAudience = await issueToken("user-alice", { audience: "https://other-api.test" });
  const wrongAudienceRes = await request("/users", { token: wrongAudience });
  expect(wrongAudienceRes.status).toBe(401);

  const missingScope = await issueToken("user-alice", { scope: "content:write" });
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
      "/grant-mirror",
      "/deferred-grants",
      "/relationships",
      "/books/{bookId}/policy-bindings",
      "/books/{bookId}/policy-denials",
      "/books/{bookId}/ownership-transfer",
      "/organizations/{orgId}/content-roles",
    ]),
  );
  expect(body.components?.securitySchemes).toHaveProperty("Bearer");
  const postsCreate = body.paths["/posts"] as { post?: { parameters?: Array<{ name?: string; in?: string }> } };
  expect(postsCreate.post?.parameters).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "idempotency-key", in: "header" })]),
  );
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
  const token = await issueToken("user-alice");
  const res = await request("/posts/missing-post", { token });
  expect(res.status).toBe(404);
});

it("reads users with field-level visibility for self", async () => {
  const token = await issueToken("user-alice");
  const res = await request("/users/user-alice", { token });
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    data: {
      id: "user-alice",
      email: "alice@example.com",
      role: null,
      
    },
  });
});

it("publishes a draft post for its author", async () => {
  const token = await issueToken("user-alice");
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

it("lists only published posts publicly and all posts for admins", async () => {
  const publicRes = await request("/posts");
  expect(publicRes.status).toBe(200);
  const publicBody = await publicRes.json() as { data: Array<{ id: string }> };
  expect(publicBody.data.map((post) => post.id)).toEqual(["post-published"]);

  const adminToken = await issueToken("user-admin");
  const adminRes = await request("/posts", { token: adminToken });
  expect(adminRes.status).toBe(200);
  const adminBody = await adminRes.json() as { data: Array<{ id: string }> };
  expect(adminBody.data.map((post) => post.id)).toEqual(["post-published", "post-draft"]);
});

it("allows the owner to publish media and anonymous users to read it after publish", async () => {
  const token = await issueToken("user-alice");
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
  const token = await issueToken("user-alice");
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
  const token = await issueToken("user-alice");
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
  const token = await issueToken("user-alice");
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
  const token = await issueToken("user-alice");
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

it("allows admin users to manage grant mirror and relationship rows", async () => {
  const token = await issueToken("user-admin");

  const mirrorRes = await request("/grant-mirror", {
    method: "POST",
    token,
    body: JSON.stringify({
      autherTupleId: "tuple-1",
      payloadUserId: "user-alice",
      entityType: "book",
      entityId: "book-1",
      relation: "viewer",
      sourceSubjectType: "user",
      requiresLiveCheck: false,
      syncStatus: "active",
      syncedAt: new Date().toISOString(),
    }),
  });
  expect(mirrorRes.status).toBe(201);

  const relationshipRes = await request("/relationships", {
    method: "POST",
    token,
    body: JSON.stringify({
      subjectType: "user",
      subjectId: "user-bob",
      relation: "viewer",
      objectType: "post",
      objectId: "post-published",
    }),
  });
  expect(relationshipRes.status).toBe(201);
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

it("replays post creation safely with the same idempotency key and rejects body mismatches", async () => {
  const token = await issueToken("user-alice");
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
  expect(await countRows("select count(*) as count from relationships where object_id = ?", firstBody.data.id)).toBe(1);
  expect(await countRows("select count(*) as count from idempotency_keys where key = ?", key)).toBe(1);
});

it("replays media creation safely with the same idempotency key and rejects body mismatches", async () => {
  const token = await issueToken("user-alice");
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
  expect(await countRows("select count(*) as count from relationships where object_id = ?", firstBody.data.media.id)).toBe(1);
  expect(await countRows("select count(*) as count from idempotency_keys where key = ?", key)).toBe(1);
});

it("replays category creation safely with the same idempotency key and rejects body mismatches", async () => {
  const token = await issueToken("user-alice");
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
  expect(await countRows("select count(*) as count from relationships where object_id = ?", firstBody.data.id)).toBe(1);
  expect(await countRows("select count(*) as count from idempotency_keys where key = ?", key)).toBe(1);
});

it("replays user creation safely with the same idempotency key and rejects body mismatches", async () => {
  const token = await issueToken("user-admin");
  const key = crypto.randomUUID();
  const body = {
    email: "retry-user@example.com",
    fullName: "Retry User",
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
    body: JSON.stringify({ ...body, fullName: "Different User" }),
  });
  expect(mismatch.status).toBe(409);

  expect(await countRows("select count(*) as count from users where email = ?", body.email)).toBe(1);
  expect(await countRows("select count(*) as count from idempotency_keys where key = ?", key)).toBe(1);
});

it("scopes idempotency keys by actor and route", async () => {
  const aliceToken = await issueToken("user-alice");
  const bobToken = await issueToken("user-bob");
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
  const token = await issueToken("user-alice");
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
  const token = await issueToken("user-alice");
  const key = crypto.randomUUID();
  const beforeRelationships = await countRows("select count(*) as count from relationships");

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
  expect(await countRows("select count(*) as count from relationships")).toBe(beforeRelationships);
});

it("validates idempotency headers as UUIDs", async () => {
  const token = await issueToken("user-alice");
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
