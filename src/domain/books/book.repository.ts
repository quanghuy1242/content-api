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
  /** Atomically publishes up to `limit` scheduled books whose `scheduled_at <= now`. */
  publishScheduledReady(now: Date, limit: number): Promise<number>;
}
