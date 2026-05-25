import type { Book } from "@/domain/books/book.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface BookRepository {
  findMany(params: { limit: number; cursor?: string }): Promise<CursorPage<Book>>;
  findById(id: string): Promise<Book | null>;
  save(book: Book): Promise<void>;
  /** Returns IDs of scheduled books whose scheduled_at is at or before `now`. */
  findScheduledReadyIds(now: Date, limit: number): Promise<readonly string[]>;
  /** Atomically publishes a scheduled book if its status is still `scheduled`. */
  publishScheduledReady(id: string, now: Date): Promise<boolean>;
}
