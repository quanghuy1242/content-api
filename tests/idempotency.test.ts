/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:test";
import {
  countRows,
  issueToken,
  issueWorkspaceShareToken,
  request,
  setupBeforeAll,
  setupBeforeEach,
} from "./helpers";

describe("idempotency", () => {
  beforeAll(setupBeforeAll);
  beforeEach(setupBeforeEach);

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
});
