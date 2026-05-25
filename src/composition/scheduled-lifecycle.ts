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
 * Iterates over each lifecycle manager and publishes every overdue scheduled
 * entity in batches using a single atomic D1 UPDATE per batch. Loops until
 * no rows are left to publish, so a large backlog is fully drained within
 * one cron tick rather than spilling into the next hour.
 */
export async function runScheduledPublish(
  managers: readonly LifecycleManager<LifecycleCapable>[],
  now: Date,
): Promise<{ transitioned: number }> {
  let transitioned = 0;
  for (const manager of managers) {
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const n = await manager.publishScheduledReady(now, SCHEDULED_PUBLISH_BATCH_LIMIT);
      if (n === 0) break;
      transitioned += n;
    }
  }
  return { transitioned };
}
