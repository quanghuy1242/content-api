/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Actor } from "@/domain/auth/actor";
import type { LifecycleCapable } from "@/domain/lifecycle/lifecycle-entity";
import type { LifecycleManager } from "@/domain/lifecycle/lifecycle-manager";
import { buildScheduledLifecycleManagers, runScheduledPublish } from "@/composition/scheduled-lifecycle";
import { issueWorkspaceShareToken, request, setupBeforeAll, setupBeforeEach } from "./helpers";


type CallRecord = {
  publishScheduledReadyCalls: Array<{ now: Date; limit: number }>;
  canCalls: string[];
};

function makeStubManager(
  results: Array<{ batch: number; response: number }>,
  calls: CallRecord,
): LifecycleManager<LifecycleCapable> {
  let callIndex = 0;
  return {
    resourceType: "stub",
    findById: async () => null,
    save: async () => {},
    canPublish: async (actor: Actor, entity: LifecycleCapable) => {
      calls.canCalls.push(`canPublish:${entity.id}`);
      return false;
    },
    canUnpublish: async (actor: Actor, entity: LifecycleCapable) => {
      calls.canCalls.push(`canUnpublish:${entity.id}`);
      return false;
    },
    canSchedule: async (actor: Actor, entity: LifecycleCapable) => {
      calls.canCalls.push(`canSchedule:${entity.id}`);
      return false;
    },
    canArchive: async (actor: Actor, entity: LifecycleCapable) => {
      calls.canCalls.push(`canArchive:${entity.id}`);
      return false;
    },
    publishScheduledReady: async (now, limit) => {
      calls.publishScheduledReadyCalls.push({ now, limit });
      const entry = results[callIndex++];
      return entry?.response ?? 0;
    },
  };
}

function emptyRecord(): CallRecord {
  return { publishScheduledReadyCalls: [], canCalls: [] };
}

describe("runScheduledPublish", () => {
  it("returns zero when no entities are ready", async () => {
    const calls = emptyRecord();
    const mgr = makeStubManager([{ batch: 1, response: 0 }], calls);
    const result = await runScheduledPublish([mgr], new Date());
    expect(result).toEqual({ transitioned: 0 });
    expect(calls.publishScheduledReadyCalls).toHaveLength(1);
  });

  it("returns the count of transitioned rows from a single batch", async () => {
    const calls = emptyRecord();
    const mgr = makeStubManager([{ batch: 1, response: 3 }], calls);
    const result = await runScheduledPublish([mgr], new Date());
    expect(result).toEqual({ transitioned: 3 });
  });

  it("loops until publishScheduledReady returns 0", async () => {
    const calls = emptyRecord();
    const mgr = makeStubManager([
      { batch: 1, response: 500 },
      { batch: 2, response: 500 },
      { batch: 3, response: 200 },
      { batch: 4, response: 0 },
    ], calls);
    const result = await runScheduledPublish([mgr], new Date());
    expect(result).toEqual({ transitioned: 1200 });
    expect(calls.publishScheduledReadyCalls).toHaveLength(4);
  });

  it("aggregates results across multiple managers", async () => {
    const calls1 = emptyRecord();
    const calls2 = emptyRecord();
    const mgr1 = makeStubManager([
      { batch: 1, response: 2 },
      { batch: 2, response: 0 },
    ], calls1);
    const mgr2 = makeStubManager([
      { batch: 1, response: 1 },
      { batch: 2, response: 0 },
    ], calls2);
    const result = await runScheduledPublish([mgr1, mgr2], new Date());
    expect(result).toEqual({ transitioned: 3 });
  });

  it("never calls can* methods on any manager", async () => {
    const calls = emptyRecord();
    const mgr = makeStubManager([{ batch: 1, response: 2 }], calls);
    await runScheduledPublish([mgr], new Date());
    expect(calls.canCalls).toHaveLength(0);
  });

  it("passes the now timestamp and batch limit to publishScheduledReady", async () => {
    const now = new Date("2030-06-01T12:00:00Z");
    const calls = emptyRecord();
    const mgr = makeStubManager([{ batch: 1, response: 1 }, { batch: 2, response: 0 }], calls);
    await runScheduledPublish([mgr], now);
    expect(calls.publishScheduledReadyCalls[0]).toEqual({ now, limit: 500 });
    expect(calls.publishScheduledReadyCalls[1]).toEqual({ now, limit: 500 });
  });

  it("is idempotent — second run after a full drain returns 0", async () => {
    let runCount = 0;
    const mgr: LifecycleManager<LifecycleCapable> = {
      resourceType: "stub",
      findById: async () => null,
      save: async () => {},
      canPublish: async () => false,
      canUnpublish: async () => false,
      canSchedule: async () => false,
      canArchive: async () => false,
      publishScheduledReady: async () => runCount++ === 0 ? 3 : 0,
    };
    const first = await runScheduledPublish([mgr], new Date());
    const second = await runScheduledPublish([mgr], new Date());
    expect(first.transitioned).toBe(3);
    expect(second.transitioned).toBe(0);
  });
});

describe("buildScheduledLifecycleManagers + D1 integration", () => {
  beforeAll(setupBeforeAll);
  beforeEach(setupBeforeEach);

  it("transitions overdue scheduled posts via the real D1 repository", async () => {
    const now = new Date();
    const ownerToken = await issueWorkspaceShareToken("user-alice");

    const schedulePost = await request("/posts/post-draft/schedule", {
      method: "POST",
      token: ownerToken,
      body: JSON.stringify({ scheduledAt: new Date(now.getTime() + 3_600_000).toISOString() }),
    });
    expect(schedulePost.status).toBe(200);

    await env.DB.prepare("UPDATE posts SET scheduled_at = ? WHERE id = 'post-draft'")
      .bind(now.getTime() - 60_000).run();

    const managers = buildScheduledLifecycleManagers(env as never);
    const result = await runScheduledPublish(managers, now);

    expect(result.transitioned).toBeGreaterThanOrEqual(1);
    const row = await env.DB.prepare("SELECT status FROM posts WHERE id = 'post-draft'")
      .first<{ status: string }>();
    expect(row?.status).toBe("published");
  });

  it("does not transition posts whose scheduled_at is still in the future", async () => {
    const now = new Date();
    const token = await issueWorkspaceShareToken("user-alice");

    await request("/posts/post-draft/schedule", {
      method: "POST",
      token,
      body: JSON.stringify({ scheduledAt: new Date(now.getTime() + 3_600_000).toISOString() }),
    });

    const managers = buildScheduledLifecycleManagers(env as never);
    const result = await runScheduledPublish(managers, now);
    expect(result.transitioned).toBe(0);

    const row = await env.DB.prepare("SELECT status FROM posts WHERE id = 'post-draft'")
      .first<{ status: string }>();
    expect(row?.status).toBe("scheduled");
  });

  it("drains multiple pages when the backlog exceeds the batch limit", async () => {
    const now = new Date();
    // Seed three overdue scheduled posts directly.
    const overdue = now.getTime() - 60_000;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO posts (id, org_id, title, slug, excerpt, content_json, author, category, status, scheduled_at) VALUES (?, ?, ?, ?, ?, json(?), ?, ?, 'scheduled', ?)",
      ).bind("post-bulk-a", "org-main", "Bulk A", "bulk-a", "A", "{}", "user-alice", "cat-alice", overdue),
      env.DB.prepare(
        "INSERT INTO posts (id, org_id, title, slug, excerpt, content_json, author, category, status, scheduled_at) VALUES (?, ?, ?, ?, ?, json(?), ?, ?, 'scheduled', ?)",
      ).bind("post-bulk-b", "org-main", "Bulk B", "bulk-b", "B", "{}", "user-alice", "cat-alice", overdue),
      env.DB.prepare(
        "INSERT INTO posts (id, org_id, title, slug, excerpt, content_json, author, category, status, scheduled_at) VALUES (?, ?, ?, ?, ?, json(?), ?, ?, 'scheduled', ?)",
      ).bind("post-bulk-c", "org-main", "Bulk C", "bulk-c", "C", "{}", "user-alice", "cat-alice", overdue),
    ]);

    const managers = buildScheduledLifecycleManagers(env as never);
    const result = await runScheduledPublish(managers, now);
    expect(result.transitioned).toBeGreaterThanOrEqual(3);

    for (const id of ["post-bulk-a", "post-bulk-b", "post-bulk-c"]) {
      const row = await env.DB.prepare("SELECT status FROM posts WHERE id = ?")
        .bind(id).first<{ status: string }>();
      expect(row?.status).toBe("published");
    }
  });
});
