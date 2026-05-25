/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { DrizzlePostRepository } from "@/infrastructure/repositories/drizzle-post.repository";
import { createDb } from "@/infrastructure/db/client";
import { issueWorkspaceShareToken, request, setupBeforeAll, setupBeforeEach } from "../helpers";

beforeAll(setupBeforeAll);
beforeEach(setupBeforeEach);

describe("publishScheduledReady compare-and-set race", () => {
  it("only the first concurrent caller transitions a scheduled row", async () => {
    const token = await issueWorkspaceShareToken("user-alice");
    const future = new Date(Date.now() + 3_600_000).toISOString();

    const schedule = await request("/posts/post-draft/schedule", {
      method: "POST",
      token,
      body: JSON.stringify({ scheduledAt: future }),
    });
    expect(schedule.status).toBe(200);

    // Backdate to make overdue.
    const now = new Date();
    await env.DB.prepare("UPDATE posts SET scheduled_at = ? WHERE id = 'post-draft'")
      .bind(now.getTime() - 60_000).run();

    const repo = new DrizzlePostRepository(createDb(env as never));
    const [first, second] = await Promise.all([
      repo.publishScheduledReady("post-draft", now),
      repo.publishScheduledReady("post-draft", now),
    ]);

    // Exactly one caller wins the compare-and-set guard.
    expect([first, second].filter(Boolean)).toHaveLength(1);

    const row = await env.DB.prepare("SELECT status FROM posts WHERE id = 'post-draft'")
      .first<{ status: string }>();
    expect(row?.status).toBe("published");
  });

  it("returns false if the row was archived between scan and update", async () => {
    const token = await issueWorkspaceShareToken("user-alice");
    const now = new Date();
    await env.DB.prepare(
      "UPDATE posts SET status = 'scheduled', scheduled_at = ? WHERE id = 'post-draft'",
    ).bind(now.getTime() - 60_000).run();

    // Archive before publishScheduledReady runs.
    const archive = await request("/posts/post-draft/archive", { method: "POST", token });
    expect(archive.status).toBe(200);

    const repo = new DrizzlePostRepository(createDb(env as never));
    const ok = await repo.publishScheduledReady("post-draft", now);
    expect(ok).toBe(false);

    const row = await env.DB.prepare("SELECT status FROM posts WHERE id = 'post-draft'")
      .first<{ status: string }>();
    expect(row?.status).toBe("archived");
  });
});
