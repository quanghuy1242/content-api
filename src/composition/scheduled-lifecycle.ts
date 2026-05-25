import type { AppBindings } from "@/config/env";
import { BookLifecycleManager } from "@/application/lifecycle/book-lifecycle-manager";
import { PostLifecycleManager } from "@/application/lifecycle/post-lifecycle-manager";
import type { LifecycleCapable } from "@/domain/lifecycle/lifecycle-entity";
import type { LifecycleManager } from "@/domain/lifecycle/lifecycle-manager";
import { createDb } from "@/infrastructure/db/client";
import { DrizzleBookRepository } from "@/infrastructure/repositories/drizzle-book.repository";
import { DrizzlePostRepository } from "@/infrastructure/repositories/drizzle-post.repository";
import { SCHEDULED_PUBLISH_BATCH_LIMIT } from "@/shared/constants";

/**
 * Builds the lifecycle managers required by the scheduled-publish cron.
 *
 * The cron path needs repositories + adapters but NOT ContentPolicy:
 * authorization was committed when the schedule was created (§5.6).
 * Adapters' can* methods are unused by the cron driver.
 */
export function buildScheduledLifecycleManagers(env: AppBindings): readonly LifecycleManager<LifecycleCapable>[] {
  const db = createDb(env);
  return [
    new PostLifecycleManager(new DrizzlePostRepository(db), undefined as never),
    new BookLifecycleManager(new DrizzleBookRepository(db), undefined as never),
  ];
}

/**
 * Iterates over each lifecycle manager and atomically publishes every overdue
 * scheduled entity using compare-and-set. No entity hydration, no can* check.
 */
export async function runScheduledPublish(
  managers: readonly LifecycleManager<LifecycleCapable>[],
  now: Date,
): Promise<{ transitioned: number; skipped: number }> {
  let transitioned = 0;
  let skipped = 0;
  for (const manager of managers) {
    // Sequential by design: D1 has per-database concurrent-write limits; bursting
    // up to 500 parallel writes per resource type would risk throttling.
    // eslint-disable-next-line no-await-in-loop
    const ids = await manager.findScheduledReadyIds(now, SCHEDULED_PUBLISH_BATCH_LIMIT);
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await manager.publishScheduledReady(id, now);
      if (ok) transitioned += 1;
      else skipped += 1;
    }
  }
  return { transitioned, skipped };
}
