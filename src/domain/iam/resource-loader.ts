import type { Book } from "@/domain/books/book.entity";
import type { BookRepository } from "@/domain/books/book.repository";
import type { ContentResourceRef } from "@/domain/iam/content-resource";
import { NotFoundError } from "@/shared/errors";

export type ContentResourceInput = { type: "book"; id: string } | { type: "org"; id: string };

export async function loadContentResource(
  books: BookRepository,
  input: ContentResourceInput,
): Promise<ContentResourceRef> {
  if (input.type === "org") {
    return organizationResource(input.id);
  }
  return loadBookResource(books, input.id);
}

export async function loadBookResource(books: BookRepository, bookId: string): Promise<ContentResourceRef> {
  const book = await books.findById(bookId);
  if (!book) throw new NotFoundError("Book not found");
  return bookResource(book);
}

export function bookResource(book: Book): ContentResourceRef {
  return {
    type: "book",
    id: book.id,
    orgId: book.orgId,
    ancestors: [{ type: "org", id: book.orgId }],
  };
}

export function organizationResource(orgId: string): ContentResourceRef {
  return {
    type: "org",
    id: orgId,
    orgId,
    ancestors: [],
  };
}
