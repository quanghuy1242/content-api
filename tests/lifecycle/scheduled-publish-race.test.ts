/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { DrizzlePostRepository } from "@/infrastructure/repositories/drizzle-post.repository";
import { createDb } from "@/infrastructure/db/client";
import { issueWorkspaceShareToken, request, setupBeforeAll, setupBeforeEach } from "../helpers";

beforeAll(setupBeforeAll);
beforeEach(setupBeforeEach);

describe("publishScheduledReady bulk compare-and-set race", () => {
  it("only the first concurrent caller transitions a scheduled row", async () => {
    const token = await issueWorkspaceShareToken("user-alice");
    const future = new Date(Date.now() + 3_600_000).toISOString();

    const schedule = await request("/posts/post-draft/schedule", {
      method: "POST",
      token,
      body: JSON.stringify({ scheduledAt: future }),
    });
    expect(schedule.status).toBe(200);

    const now = new Date();
    await env.DB.prepare("UPDATE posts SET scheduled_at = ? WHERE id = 'post-draft'")
      .bind(now.getTime() - 60_000).run();

    const repo = new DrizzlePostRepository(createDb(env as never));
    const [first, second] = await Promise.all([
      repo.publishScheduledReady(now, 100),
      repo.publishScheduledReady(now, 100),
    ]);

    // Exactly one invocation sees the row; the other gets 0.
    expect(first + second).toBe(1);

    const row = await env.DB.prepare("SELECT status FROM posts WHERE id = 'post-draft'")
      .first<{ status: string }>();
    expect(row?.status).toBe("published");
  });

  it("returns 0 if the row was archived before the bulk update", async () => {
    const token = await issueWorkspaceShareToken("user-alice");
    const now = new Date();
    await env.DB.prepare(
      "UPDATE posts SET status = 'scheduled', scheduled_at = ? WHERE id = 'post-draft'",
    ).bind(now.getTime() - 60_000).run();

    const archive = await request("/posts/post-draft/archive", { method: "POST", token });
    expect(archive.status).toBe(200);

    const repo = new DrizzlePostRepository(createDb(env as never));
    const n = await repo.publishScheduledReady(now, 100);
    expect(n).toBe(0);

    const row = await env.DB.prepare("SELECT status FROM posts WHERE id = 'post-draft'")
      .first<{ status: string }>();
    expect(row?.status).toBe("archived");
  });

  it("correctly counts multiple rows while skipping already-archived ones", async () => {
    const token = await issueWorkspaceShareToken("user-alice");
    const now = new Date();
    const overdue = now.getTime() - 60_000;

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO posts (id, org_id, title, slug, excerpt, content_json, author, category, status, scheduled_at) VALUES (?, ?, ?, ?, ?, json(?), ?, ?, 'scheduled', ?)",
      ).bind("post-race-1", "org-main", "Race 1", "race-1", "R1", "{}", "user-alice", "cat-alice", overdue),
      env.DB.prepare(
        "INSERT INTO posts (id, org_id, title, slug, excerpt, content_json, author, category, status, scheduled_at) VALUES (?, ?, ?, ?, ?, json(?), ?, ?, 'scheduled', ?)",
      ).bind("post-race-2", "org-main", "Race 2", "race-2", "R2", "{}", "user-alice", "cat-alice", overdue),
      env.DB.prepare(
        "INSERT INTO posts (id, org_id, title, slug, excerpt, content_json, author, category, status, scheduled_at) VALUES (?, ?, ?, ?, ?, json(?), ?, ?, 'scheduled', ?)",
      ).bind("post-race-3", "org-main", "Race 3", "race-3", "R3", "{}", "user-alice", "cat-alice", overdue),
      env.DB.prepare(
        "INSERT INTO content_policy_bindings (id, org_id, principal_type, principal_id, role_id, resource_type, resource_id, created_by_type, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind("binding-post-race-2", "org-main", "user", "user-alice", "system:post.owner", "post", "post-race-2", "user", "user-alice"),
    ]);

    // Archive post-race-2 before the bulk update runs.
    const archive = await request("/posts/post-race-2/archive", { method: "POST", token });
    expect(archive.status).toBe(200);

    const repo = new DrizzlePostRepository(createDb(env as never));
    const n = await repo.publishScheduledReady(now, 100);
    // Only 1 and 3 should transition; 2 was archived.
    expect(n).toBe(2);

    const r1 = await env.DB.prepare("SELECT status FROM posts WHERE id = 'post-race-1'")
      .first<{ status: string }>();
    expect(r1?.status).toBe("published");

    const r2 = await env.DB.prepare("SELECT status FROM posts WHERE id = 'post-race-2'")
      .first<{ status: string }>();
    expect(r2?.status).toBe("archived");

    const r3 = await env.DB.prepare("SELECT status FROM posts WHERE id = 'post-race-3'")
      .first<{ status: string }>();
    expect(r3?.status).toBe("published");
  });
});
