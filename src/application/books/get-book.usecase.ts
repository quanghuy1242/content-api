import type { Actor } from "@/domain/auth/actor";
import { actorWithReadScope } from "@/domain/auth/scopes";
import type { BookRepository } from "@/domain/books/book.repository";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { bookResource } from "@/domain/iam/resource-loader";
import { ForbiddenError, NotFoundError } from "@/shared/errors";

export class GetBookUseCase {
  constructor(
    private readonly books: BookRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: { actor: Actor | null; bookId: string }) {
    const book = await this.books.findById(params.bookId);
    if (!book) throw new NotFoundError("Book not found");
    if (book.visibility === "public" && book.status === "published") return book;

    const allowed = await this.contentPolicy.can({
      actor: actorWithReadScope(params.actor),
      permission: "book.read",
      resource: bookResource(book),
    });
    if (!allowed) throw new ForbiddenError("You cannot read this book");
    return book;
  }
}
