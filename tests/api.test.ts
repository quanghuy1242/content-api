/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import migrationSql from "../drizzle/0000_dapper_korvac.sql?raw";
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
  for (const statement of migrationSql
    .split("--> statement-breakpoint")
    .map((statementText) => statementText.trim())
    .filter(Boolean)) {
    await env.DB.prepare(statement).run();
  }

  await env.DB.batch([
    env.DB.prepare("insert into users (id, email, full_name, role, better_auth_user_id) values (?, ?, ?, ?, ?)")
      .bind("user-admin", "admin@example.com", "Admin User", "admin", "auth-admin"),
    env.DB.prepare("insert into users (id, email, full_name, role, better_auth_user_id) values (?, ?, ?, ?, ?)")
      .bind("user-alice", "alice@example.com", "Alice User", "user", "auth-alice"),
    env.DB.prepare("insert into users (id, email, full_name, role, better_auth_user_id) values (?, ?, ?, ?, ?)")
      .bind("user-bob", "bob@example.com", "Bob User", "user", "auth-bob"),
    env.DB.prepare("insert into media (id, alt, owner, url, filename, mime_type, filesize, width, height, status, visibility) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("media-alice", "Alice image", "user-alice", "https://cdn.test/alice.jpg", "alice.jpg", "image/jpeg", 1234, 100, 100, "ready", "private"),
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
    },
  });
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
