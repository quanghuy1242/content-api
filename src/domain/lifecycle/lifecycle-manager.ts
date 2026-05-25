import type { Actor } from "@/domain/auth/actor";
import type { LifecycleCapable, LifecycleStatus } from "./lifecycle-entity";

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
  /** Persists a lifecycle transition only if the loaded source status is unchanged. */
  save(entity: T, expectedStatus: LifecycleStatus): Promise<void>;

  /** Authorization checks. Each adapter decides which permission key applies. */
  canPublish(actor: Actor, entity: T): Promise<boolean>;
  canUnpublish(actor: Actor, entity: T): Promise<boolean>;
  canSchedule(actor: Actor, entity: T): Promise<boolean>;
  canArchive(actor: Actor, entity: T): Promise<boolean>;

  /**
   * Atomically transitions up to `limit` rows from `scheduled` to `published`
   * where `status = 'scheduled' AND scheduled_at <= now`. Returns the number
   * of rows that actually transitioned. A single D1 UPDATE with a subquery
   * guard — no SELECT-then-loop.
   *
   * Cron driver calls this in a do…while until it returns 0.
   */
  publishScheduledReady(now: Date, limit: number): Promise<number>;
}
