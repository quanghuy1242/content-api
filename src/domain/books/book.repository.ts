import type { Book } from "@/domain/books/book.entity";

export interface BookRepository {
  findById(id: string): Promise<Book | null>;
  create(book: Book): Promise<Book>;
}
