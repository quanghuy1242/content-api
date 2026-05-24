import type { Book } from "@/domain/books/book.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface BookRepository {
  findMany(params: { limit: number; cursor?: string }): Promise<CursorPage<Book>>;
  findById(id: string): Promise<Book | null>;
  save(book: Book): Promise<void>;
}
