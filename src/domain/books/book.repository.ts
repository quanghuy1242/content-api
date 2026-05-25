import type { Book } from "@/domain/books/book.entity";
import type { LifecycleStatus } from "@/domain/lifecycle/lifecycle-entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface BookRepository {
  findMany(params: { limit: number; cursor?: string }): Promise<CursorPage<Book>>;
  findById(id: string): Promise<Book | null>;
  /** Persists mutable metadata only while the row has not been archived. */
  save(book: Book): Promise<void>;
  /** Persists a lifecycle transition through an optimistic status guard. */
  saveLifecycle(book: Book, expectedStatus: LifecycleStatus): Promise<void>;
  /** Returns IDs of scheduled books whose scheduled_at is at or before `now`. */
  findScheduledReadyIds(now: Date, limit: number): Promise<readonly string[]>;
  /** Atomically publishes a scheduled book if its status is still `scheduled`. */
  publishScheduledReady(id: string, now: Date): Promise<boolean>;
}
