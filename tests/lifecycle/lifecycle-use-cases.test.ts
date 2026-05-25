import { describe, expect, it } from "vitest";
import type { Actor } from "@/domain/auth/actor";
import type { LifecycleCapable, LifecycleStatus } from "@/domain/lifecycle/lifecycle-entity";
import type { LifecycleManager } from "@/domain/lifecycle/lifecycle-manager";
import { ArchiveUseCase } from "@/application/lifecycle/archive.usecase";
import { PublishUseCase } from "@/application/lifecycle/publish.usecase";
import { SchedulePublishUseCase } from "@/application/lifecycle/schedule-publish.usecase";
import { UnpublishUseCase } from "@/application/lifecycle/unpublish.usecase";

// Minimal LifecycleCapable stub with a mutable status.
class StubEntity implements LifecycleCapable {
  publishedAt: Date | null = null;
  scheduledAt: Date | null = null;
  archivedAt: Date | null = null;

  constructor(
    public readonly id: string,
    public lifecycleStatus: LifecycleStatus = "draft",
  ) {}

  publish() {
    if (this.lifecycleStatus === "archived") throw new Error("already archived");
    if (this.lifecycleStatus === "published") throw new Error("already published");
    this.lifecycleStatus = "published";
    this.publishedAt = new Date();
  }
  unpublish() {
    if (this.lifecycleStatus === "archived") throw new Error("already archived");
    if (this.lifecycleStatus === "draft") throw new Error("already draft");
    this.lifecycleStatus = "draft";
    this.publishedAt = null;
  }
  schedule(scheduledAt: Date) {
    if (this.lifecycleStatus !== "draft") throw new Error("not draft");
    this.lifecycleStatus = "scheduled";
    this.scheduledAt = scheduledAt;
  }
  archive() {
    if (this.lifecycleStatus === "archived") throw new Error("already archived");
    this.lifecycleStatus = "archived";
    this.archivedAt = new Date();
  }
}

function makeManager(entity: StubEntity | null, canResult = true) {
  const saved: Array<{ entity: StubEntity; expectedStatus: LifecycleStatus }> = [];
  const mgr: LifecycleManager<StubEntity> = {
    resourceType: "stub",
    findById: async () => entity,
    save: async (savedEntity, expectedStatus) => { saved.push({ entity: savedEntity, expectedStatus }); },
    canPublish: async () => canResult,
    canUnpublish: async () => canResult,
    canSchedule: async () => canResult,
    canArchive: async () => canResult,
    findScheduledReadyIds: async () => [],
    publishScheduledReady: async () => false,
  };
  return { mgr, saved };
}

function writer(): Actor {
  return { type: "user", id: "u1", subject: "u1", role: "user", scopes: ["content:write"], teamIds: [] };
}

function noScope(): Actor {
  return { type: "user", id: "u1", subject: "u1", role: "user", scopes: ["content:read"], teamIds: [] };
}

describe("PublishUseCase", () => {
  it("transitions a draft entity to published", async () => {
    const entity = new StubEntity("e1", "draft");
    const { mgr, saved } = makeManager(entity);
    const result = await new PublishUseCase(mgr).execute({ actor: writer(), id: "e1" });
    expect(result.lifecycleStatus).toBe("published");
    expect(saved[0]).toEqual({ entity, expectedStatus: "draft" });
  });

  it("rejects actors without content:write scope", async () => {
    const { mgr } = makeManager(new StubEntity("e1"));
    await expect(new PublishUseCase(mgr).execute({ actor: noScope(), id: "e1" }))
      .rejects.toThrow("OAuth scope required: content:write");
  });

  it("throws NotFoundError when entity is missing", async () => {
    const { mgr } = makeManager(null);
    await expect(new PublishUseCase(mgr).execute({ actor: writer(), id: "missing" }))
      .rejects.toMatchObject({ message: expect.stringContaining("not found") });
  });

  it("throws ForbiddenError when policy denies publish", async () => {
    const { mgr } = makeManager(new StubEntity("e1"), false);
    await expect(new PublishUseCase(mgr).execute({ actor: writer(), id: "e1" }))
      .rejects.toMatchObject({ message: expect.stringContaining("cannot publish") });
  });
});

describe("UnpublishUseCase", () => {
  it("transitions a published entity back to draft", async () => {
    const entity = new StubEntity("e1", "published");
    const { mgr, saved } = makeManager(entity);
    const result = await new UnpublishUseCase(mgr).execute({ actor: writer(), id: "e1" });
    expect(result.lifecycleStatus).toBe("draft");
    expect(saved[0]).toEqual({ entity, expectedStatus: "published" });
  });

  it("rejects actors without content:write scope", async () => {
    const { mgr } = makeManager(new StubEntity("e1", "published"));
    await expect(new UnpublishUseCase(mgr).execute({ actor: noScope(), id: "e1" }))
      .rejects.toThrow("OAuth scope required: content:write");
  });

  it("throws NotFoundError when entity is missing", async () => {
    const { mgr } = makeManager(null);
    await expect(new UnpublishUseCase(mgr).execute({ actor: writer(), id: "missing" }))
      .rejects.toMatchObject({ message: expect.stringContaining("not found") });
  });
});

describe("SchedulePublishUseCase", () => {
  it("transitions a draft entity to scheduled", async () => {
    const entity = new StubEntity("e1", "draft");
    const { mgr, saved } = makeManager(entity);
    const future = new Date(Date.now() + 3_600_000);
    const result = await new SchedulePublishUseCase(mgr).execute({
      actor: writer(), id: "e1", scheduledAt: future,
    });
    expect(result.lifecycleStatus).toBe("scheduled");
    expect(result.scheduledAt).toEqual(future);
    expect(saved[0]).toEqual({ entity, expectedStatus: "draft" });
  });

  it("rejects a past scheduledAt timestamp", async () => {
    const { mgr } = makeManager(new StubEntity("e1"));
    const past = new Date(Date.now() - 1000);
    await expect(new SchedulePublishUseCase(mgr).execute({ actor: writer(), id: "e1", scheduledAt: past }))
      .rejects.toMatchObject({ message: expect.stringContaining("future") });
  });

  it("respects injected clock for future check", async () => {
    const entity = new StubEntity("e1", "draft");
    const { mgr } = makeManager(entity);
    const fixedNow = new Date("2030-01-01T00:00:00Z");
    const future = new Date("2030-01-02T00:00:00Z");
    const useCase = new SchedulePublishUseCase(mgr, () => fixedNow);
    const result = await useCase.execute({ actor: writer(), id: "e1", scheduledAt: future });
    expect(result.lifecycleStatus).toBe("scheduled");
  });

  it("rejects actors without content:write scope", async () => {
    const { mgr } = makeManager(new StubEntity("e1"));
    const future = new Date(Date.now() + 3_600_000);
    await expect(new SchedulePublishUseCase(mgr).execute({ actor: noScope(), id: "e1", scheduledAt: future }))
      .rejects.toThrow("OAuth scope required: content:write");
  });

  it("throws ForbiddenError when policy denies schedule", async () => {
    const entity = new StubEntity("e1", "draft");
    const { mgr } = makeManager(entity, false);
    const future = new Date(Date.now() + 3_600_000);
    await expect(new SchedulePublishUseCase(mgr).execute({ actor: writer(), id: "e1", scheduledAt: future }))
      .rejects.toMatchObject({ message: expect.stringContaining("cannot schedule") });
  });
});

describe("ArchiveUseCase", () => {
  it("transitions any non-archived entity to archived", async () => {
    for (const status of ["draft", "scheduled", "published"] as LifecycleStatus[]) {
      const entity = new StubEntity("e1", status);
      const { mgr } = makeManager(entity);
      const result = await new ArchiveUseCase(mgr).execute({ actor: writer(), id: "e1" });
      expect(result.lifecycleStatus).toBe("archived");
      expect(result.archivedAt).not.toBeNull();
    }
  });

  it("rejects actors without content:write scope", async () => {
    const { mgr } = makeManager(new StubEntity("e1"));
    await expect(new ArchiveUseCase(mgr).execute({ actor: noScope(), id: "e1" }))
      .rejects.toThrow("OAuth scope required: content:write");
  });

  it("throws NotFoundError when entity is missing", async () => {
    const { mgr } = makeManager(null);
    await expect(new ArchiveUseCase(mgr).execute({ actor: writer(), id: "missing" }))
      .rejects.toMatchObject({ message: expect.stringContaining("not found") });
  });

  it("throws ForbiddenError when policy denies archive", async () => {
    const { mgr } = makeManager(new StubEntity("e1"), false);
    await expect(new ArchiveUseCase(mgr).execute({ actor: writer(), id: "e1" }))
      .rejects.toMatchObject({ message: expect.stringContaining("cannot archive") });
  });
});
