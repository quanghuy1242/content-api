export type LifecycleStatus = "draft" | "scheduled" | "published" | "archived";

/**
 * Structural contract for entities that opt into the lifecycle plugin.
 * Entities own the state machine guard; the application layer never
 * mutates `lifecycleStatus` directly.
 */
export interface LifecycleCapable {
  readonly id: string;
  readonly lifecycleStatus: LifecycleStatus;
  readonly publishedAt: Date | null;
  readonly scheduledAt: Date | null;
  readonly archivedAt: Date | null;

  /** draft|scheduled → published. ConflictError if already published or archived. */
  publish(): void;
  /** scheduled|published → draft. ConflictError if draft or archived. */
  unpublish(): void;
  /** draft → scheduled. ConflictError if already scheduled, published, or archived. */
  schedule(scheduledAt: Date): void;
  /** any non-archived → archived. ConflictError if already archived. Terminal. */
  archive(): void;
}
