import type { z } from "zod";
import type { Book } from "@/domain/books/book.entity";
import type { bookResponseSchema } from "@/http/schemas/books.schema";

export function presentBook(book: Book): z.infer<typeof bookResponseSchema> {
  const snapshot = book.toSnapshot();
  return {
    ...snapshot,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}
