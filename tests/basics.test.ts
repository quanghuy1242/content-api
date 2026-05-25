/// <reference types="@cloudflare/vitest-pool-workers/types" />

import {
  issueServiceAccountToken,
  issueToken,
  issueWorkspaceShareToken,
  request,
  setupBeforeAll,
  setupBeforeEach,
} from "./helpers";

describe("basics", () => {
  beforeAll(setupBeforeAll);
  beforeEach(setupBeforeEach);

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
    body: JSON.stringify({ description: "Bob should not be able to update Alice category" }),
  });
  expect(categoryWrite.status).toBe(403);
});

it("returns 403 when a user without an org-level category role updates a category", async () => {
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
});

