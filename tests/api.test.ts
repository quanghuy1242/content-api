/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { createExecutionContext, env, reset, waitOnExecutionContext } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import migrationSql0000 from "../drizzle/0000_dapper_korvac.sql?raw";
import migrationSql0001 from "../drizzle/0001_unique_starhawk.sql?raw";
import migrationSql0002 from "../drizzle/0002_media_upload_flow.sql?raw";
import { createApp } from "@/main";

const AUTH_ISSUER = "https://auth.test";
const AUTH_AUDIENCE = "payload-content-api";
const AUTH_JWKS_URL = "https://auth.test/api/auth/jwks";

let privateKey: CryptoKey;
let publicJwk: JWK;

const app = createApp({
  fetchImpl: async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === AUTH_JWKS_URL) {
      return Response.json({ keys: [publicJwk] });
    }
    return fetch(input);
  },
});

async function issueToken(subject: string, roles: string[] = []) {
  return new SignJWT({
    token_use: "access",
    email: `${subject}@example.com`,
    roles,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "JWT" })
    .setIssuer(AUTH_ISSUER)
    .setAudience(AUTH_AUDIENCE)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

async function seed() {
  for (const migrationSql of [migrationSql0000, migrationSql0001, migrationSql0002]) {
    for (const statement of migrationSql
      .split("--> statement-breakpoint")
      .map((statementText) => statementText.trim())
      .filter(Boolean)) {
      await env.DB.prepare(statement).run();
    }
  }

  await env.DB.batch([
    env.DB.prepare("insert into users (id, email, full_name, role, better_auth_user_id) values (?, ?, ?, ?, ?)")
      .bind("user-admin", "admin@example.com", "Admin User", "admin", "auth-admin"),
    env.DB.prepare("insert into users (id, email, full_name, role, better_auth_user_id) values (?, ?, ?, ?, ?)")
      .bind("user-alice", "alice@example.com", "Alice User", "user", "auth-alice"),
    env.DB.prepare("insert into users (id, email, full_name, role, better_auth_user_id) values (?, ?, ?, ?, ?)")
      .bind("user-bob", "bob@example.com", "Bob User", "user", "auth-bob"),
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
    ]),
  );
  expect(body.components?.securitySchemes).toHaveProperty("Bearer");
  const postsCreate = body.paths["/posts"] as { post?: { parameters?: Array<{ name?: string; in?: string }> } };
  expect(postsCreate.post?.parameters).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "idempotency-key", in: "header" })]),
  );
});

it("returns 403 when a non-owner updates a protected category", async () => {
  const token = await issueToken("auth-bob");
  const res = await request("/categories/cat-alice", {
    method: "PATCH",
    token,
    body: JSON.stringify({ description: "Nope" }),
  });
  expect(res.status).toBe(403);
});

it("returns 404 for missing resources", async () => {
  const token = await issueToken("auth-alice");
  const res = await request("/posts/missing-post", { token });
  expect(res.status).toBe(404);
});

it("reads users with field-level visibility for self", async () => {
  const token = await issueToken("auth-alice");
  const res = await request("/users/user-alice", { token });
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    data: {
      id: "user-alice",
      email: "alice@example.com",
      role: null,
      betterAuthUserId: null,
    },
  });
});

it("publishes a draft post for its author", async () => {
  const token = await issueToken("auth-alice");
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

  const adminToken = await issueToken("auth-admin", ["admin"]);
  const adminRes = await request("/posts", { token: adminToken });
  expect(adminRes.status).toBe(200);
  const adminBody = await adminRes.json() as { data: Array<{ id: string }> };
  expect(adminBody.data.map((post) => post.id)).toEqual(["post-published", "post-draft"]);
});

it("allows the owner to publish media and anonymous users to read it after publish", async () => {
  const token = await issueToken("auth-alice");
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
  const token = await issueToken("auth-alice");
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
  const token = await issueToken("auth-alice");
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
  const token = await issueToken("auth-alice");
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
  const token = await issueToken("auth-alice");
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
  const token = await issueToken("auth-admin", ["admin"]);

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

it("replays post creation safely with the same idempotency key and rejects body mismatches", async () => {
  const token = await issueToken("auth-alice");
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
  const token = await issueToken("auth-alice");
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
  const token = await issueToken("auth-alice");
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
  const token = await issueToken("auth-admin", ["admin"]);
  const key = crypto.randomUUID();
  const body = {
    email: "retry-user@example.com",
    fullName: "Retry User",
    role: "user",
    avatar: null,
    bio: { summary: "retry" },
    betterAuthUserId: "auth-retry-user",
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
  const aliceToken = await issueToken("auth-alice");
  const bobToken = await issueToken("auth-bob");
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
  const token = await issueToken("auth-alice");
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
  const token = await issueToken("auth-alice");
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
  const token = await issueToken("auth-alice");
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
