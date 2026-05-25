/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:test";
import { createDb } from "@/infrastructure/db/client";
import { DrizzlePostRepository } from "@/infrastructure/repositories/drizzle-post.repository";
import {
  issueToken,
  issueWorkspaceShareToken,
  request,
  setupBeforeAll,
  setupBeforeEach,
} from "./helpers";

beforeAll(setupBeforeAll);
beforeEach(setupBeforeEach);

it("schedules a draft post with a future timestamp", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const res = await request("/posts/post-draft/schedule", {
    method: "POST",
    token,
    body: JSON.stringify({ scheduledAt: future }),
  });
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    data: { id: "post-draft", status: "scheduled", scheduledAt: future },
  });
});

it("rejects a schedule request with a past timestamp", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const past = new Date(Date.now() - 1000).toISOString();
  const res = await request("/posts/post-draft/schedule", {
    method: "POST",
    token,
    body: JSON.stringify({ scheduledAt: past }),
  });
  expect(res.status).toBe(400);
});

it("rejects a schedule request on an already-scheduled post", async () => {
  await env.DB.prepare(
    "UPDATE posts SET status = 'scheduled', scheduled_at = ? WHERE id = 'post-draft'",
  ).bind(Date.now() + 3_600_000).run();

  const token = await issueWorkspaceShareToken("user-alice");
  const future = new Date(Date.now() + 7_200_000).toISOString();
  const res = await request("/posts/post-draft/schedule", {
    method: "POST",
    token,
    body: JSON.stringify({ scheduledAt: future }),
  });
  expect(res.status).toBe(409);
});

it("cancels a scheduled post back to draft via unpublish", async () => {
  await env.DB.prepare(
    "UPDATE posts SET status = 'scheduled', scheduled_at = ? WHERE id = 'post-draft'",
  ).bind(Date.now() + 3_600_000).run();

  const token = await issueWorkspaceShareToken("user-alice");
  const res = await request("/posts/post-draft/unpublish", { method: "POST", token });
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    data: { id: "post-draft", status: "draft", scheduledAt: null },
  });
});

it("unpublishes a published post back to draft", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const res = await request("/posts/post-published/unpublish", { method: "POST", token });
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    data: { id: "post-published", status: "draft" },
  });
});

it("archives a draft post and rejects a second archive attempt", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const first = await request("/posts/post-draft/archive", { method: "POST", token });
  expect(first.status).toBe(200);
  await expect(first.json()).resolves.toMatchObject({
    data: { id: "post-draft", status: "archived" },
  });

  const second = await request("/posts/post-draft/archive", { method: "POST", token });
  expect(second.status).toBe(409);
});

it("archives a published post", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const res = await request("/posts/post-published/archive", { method: "POST", token });
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    data: { id: "post-published", status: "archived" },
  });
});

it("rejects metadata updates on an archived post", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const archive = await request("/posts/post-draft/archive", { method: "POST", token });
  expect(archive.status).toBe(200);

  const update = await request("/posts/post-draft", {
    method: "PATCH",
    token,
    body: JSON.stringify({ title: "Renamed Archived Post" }),
  });
  expect(update.status).toBe(409);
});

it("prevents stale metadata and lifecycle saves from reviving an archived post", async () => {
  const repo = new DrizzlePostRepository(createDb(env as never));
  const staleMetadata = await repo.findById("post-draft");
  const staleLifecycle = await repo.findById("post-draft");
  expect(staleMetadata).not.toBeNull();
  expect(staleLifecycle).not.toBeNull();
  staleMetadata!.update({ title: "Stale Rename" });
  staleLifecycle!.publish();

  const token = await issueWorkspaceShareToken("user-alice");
  const archive = await request("/posts/post-draft/archive", { method: "POST", token });
  expect(archive.status).toBe(200);

  await expect(repo.save(staleMetadata!)).rejects.toThrow("Cannot update an archived post");
  await expect(repo.saveLifecycle(staleLifecycle!, "draft")).rejects.toThrow("Post lifecycle state changed");

  const row = await env.DB.prepare("SELECT status, title FROM posts WHERE id = 'post-draft'")
    .first<{ status: string; title: string }>();
  expect(row).toMatchObject({ status: "archived", title: "Draft Post" });
});

it("rejects publish on an already-published post with 409", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const res = await request("/posts/post-published/publish", { method: "POST", token });
  expect(res.status).toBe(409);
});

it("rejects lifecycle actions without content:write scope", async () => {
  const readOnly = await issueToken("user-alice", { scope: "content:read" });
  const responses = await Promise.all([
    request("/posts/post-draft/publish", { method: "POST", token: readOnly }),
    request("/posts/post-draft/archive", { method: "POST", token: readOnly }),
    request("/posts/post-draft/schedule", {
      method: "POST",
      token: readOnly,
      body: JSON.stringify({ scheduledAt: new Date(Date.now() + 3_600_000).toISOString() }),
    }),
  ]);
  expect(responses.every((r) => r.status === 403)).toBe(true);
});

it("rejects lifecycle actions without a content policy binding", async () => {
  const bob = await issueWorkspaceShareToken("user-bob");
  const publish = await request("/posts/post-draft/publish", { method: "POST", token: bob });
  expect(publish.status).toBe(403);

  const archive = await request("/posts/post-draft/archive", { method: "POST", token: bob });
  expect(archive.status).toBe(403);
});
