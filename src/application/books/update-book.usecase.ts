import type { Actor } from "@/domain/auth/actor";
import { requireContentScope } from "@/domain/auth/scopes";
import type { UpdateBookProps } from "@/domain/books/book.entity";
import type { BookRepository } from "@/domain/books/book.repository";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { bookResource } from "@/domain/iam/resource-loader";
import { ForbiddenError, NotFoundError } from "@/shared/errors";

export class UpdateBookUseCase {
  constructor(
    private readonly books: BookRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: { actor: Actor; bookId: string; input: UpdateBookProps }) {
    requireContentScope(params.actor, "content:write");
    const book = await this.books.findById(params.bookId);
    if (!book) throw new NotFoundError("Book not found");

    const allowed = await this.contentPolicy.can({
      actor: params.actor,
      permission: "book.update",
      resource: bookResource(book),
    });
    if (!allowed) throw new ForbiddenError("You cannot update this book");

    book.update(params.input);
    await this.books.save(book);
    return book;
  }
}
