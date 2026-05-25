/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Actor } from "@/domain/auth/actor";
import type { LifecycleCapable } from "@/domain/lifecycle/lifecycle-entity";
import type { LifecycleManager } from "@/domain/lifecycle/lifecycle-manager";
import { buildScheduledLifecycleManagers, runScheduledPublish } from "@/composition/scheduled-lifecycle";
import { issueWorkspaceShareToken, request, setupBeforeAll, setupBeforeEach } from "./helpers";

beforeAll(setupBeforeAll);
beforeEach(setupBeforeEach);

type CallRecord = {
  findScheduledReadyIdsCalls: Array<{ now: Date; limit: number }>;
  publishScheduledReadyCalls: Array<{ id: string; now: Date }>;
  canCalls: string[];
};

function makeStubManager(
  scheduledIds: string[],
  publishResults: Record<string, boolean>,
  calls: CallRecord,
): LifecycleManager<LifecycleCapable> {
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
    findScheduledReadyIds: async (now, limit) => {
      calls.findScheduledReadyIdsCalls.push({ now, limit });
      return scheduledIds;
    },
    publishScheduledReady: async (id, now) => {
      calls.publishScheduledReadyCalls.push({ id, now });
      return publishResults[id] ?? false;
    },
  };
}

function emptyRecord(): CallRecord {
  return { findScheduledReadyIdsCalls: [], publishScheduledReadyCalls: [], canCalls: [] };
}

describe("runScheduledPublish", () => {
  it("returns zero counts when no entities are ready", async () => {
    const calls = emptyRecord();
    const mgr = makeStubManager([], {}, calls);
    const result = await runScheduledPublish([mgr], new Date());
    expect(result).toEqual({ transitioned: 0, skipped: 0 });
    expect(calls.findScheduledReadyIdsCalls).toHaveLength(1);
  });

  it("counts transitioned and skipped correctly", async () => {
    const calls = emptyRecord();
    const mgr = makeStubManager(["a", "b", "c"], { a: true, b: false, c: true }, calls);
    const result = await runScheduledPublish([mgr], new Date());
    expect(result).toEqual({ transitioned: 2, skipped: 1 });
    expect(calls.publishScheduledReadyCalls).toHaveLength(3);
  });

  it("aggregates results across multiple managers", async () => {
    const calls1 = emptyRecord();
    const calls2 = emptyRecord();
    const mgr1 = makeStubManager(["p1"], { p1: true }, calls1);
    const mgr2 = makeStubManager(["b1", "b2"], { b1: true, b2: false }, calls2);
    const result = await runScheduledPublish([mgr1, mgr2], new Date());
    expect(result).toEqual({ transitioned: 2, skipped: 1 });
  });

  it("never calls can* methods on any manager", async () => {
    const calls = emptyRecord();
    const mgr = makeStubManager(["e1", "e2"], { e1: true, e2: true }, calls);
    await runScheduledPublish([mgr], new Date());
    expect(calls.canCalls).toHaveLength(0);
  });

  it("passes the same `now` timestamp to findScheduledReadyIds and publishScheduledReady", async () => {
    const now = new Date("2030-06-01T12:00:00Z");
    const calls = emptyRecord();
    const mgr = makeStubManager(["e1"], { e1: true }, calls);
    await runScheduledPublish([mgr], now);
    expect(calls.findScheduledReadyIdsCalls[0]?.now).toEqual(now);
    expect(calls.publishScheduledReadyCalls[0]).toEqual({ id: "e1", now });
  });

  it("is idempotent when findScheduledReadyIds returns empty on the second run", async () => {
    let runCount = 0;
    const mgr: LifecycleManager<LifecycleCapable> = {
      resourceType: "stub",
      findById: async () => null,
      save: async () => {},
      canPublish: async () => false,
      canUnpublish: async () => false,
      canSchedule: async () => false,
      canArchive: async () => false,
      findScheduledReadyIds: async () => runCount++ === 0 ? ["e1"] : [],
      publishScheduledReady: async () => true,
    };
    const first = await runScheduledPublish([mgr], new Date());
    const second = await runScheduledPublish([mgr], new Date());
    expect(first.transitioned).toBe(1);
    expect(second.transitioned).toBe(0);
  });
});

describe("buildScheduledLifecycleManagers + D1 integration", () => {
  it("transitions overdue scheduled posts via the real D1 repository", async () => {
    const now = new Date();
    const ownerToken = await issueWorkspaceShareToken("user-alice");

    const schedulePost = await request("/posts/post-draft/schedule", {
      method: "POST",
      token: ownerToken,
      body: JSON.stringify({ scheduledAt: new Date(now.getTime() + 3_600_000).toISOString() }),
    });
    expect(schedulePost.status).toBe(200);

    // Backdate to make overdue.
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
});
