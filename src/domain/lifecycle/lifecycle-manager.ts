import type { Actor } from "@/domain/auth/actor";
import type { LifecycleCapable } from "./lifecycle-entity";

/**
 * Per-resource adapter that connects a `LifecycleCapable` entity to:
 *   - its persistence (findById, save, scheduled-ready scan, compare-and-set publish)
 *   - its Content IAM authorization vocabulary
 *
 * The generic use cases only see this interface. They never import a
 * specific repository, entity, or permission key.
 */
export interface LifecycleManager<T extends LifecycleCapable> {
  /** Short label used in error messages: "post", "book", "site_config". */
  readonly resourceType: string;

  findById(id: string): Promise<T | null>;
  save(entity: T): Promise<void>;

  /** Authorization checks. Each adapter decides which permission key applies. */
  canPublish(actor: Actor, entity: T): Promise<boolean>;
  canUnpublish(actor: Actor, entity: T): Promise<boolean>;
  canSchedule(actor: Actor, entity: T): Promise<boolean>;
  canArchive(actor: Actor, entity: T): Promise<boolean>;

  /**
   * Lists IDs of entities whose schedule is overdue at `now`.
   * Used by the cron driver. Implementations return at most `limit` IDs.
   */
  findScheduledReadyIds(now: Date, limit: number): Promise<readonly string[]>;

  /**
   * Atomically transitions the row from `scheduled` to `published` if and
   * only if its current status is `scheduled` and `scheduled_at <= now`.
   * Returns true if the row transitioned, false otherwise.
   *
   * This is the only safe cron transition primitive under D1.
   */
  publishScheduledReady(id: string, now: Date): Promise<boolean>;
}
