import type { Actor } from "@/domain/authz/actor";
import { actorWithReadScope } from "@/domain/authz/scopes";
import type { Book } from "@/domain/books/book.entity";
import type { BookRepository } from "@/domain/books/book.repository";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { bookResource } from "@/domain/iam/resource-loader";

export class ListBooksUseCase {
  constructor(
    private readonly books: BookRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  async execute(params: { actor: Actor | null; limit: number; cursor?: string }) {
    const page = await this.books.findMany({ limit: params.limit, cursor: params.cursor });
    const restricted = page.data.filter((book) => !isPublicPublished(book));
    const decisions = await this.contentPolicy.canMany({
      actor: actorWithReadScope(params.actor),
      permission: "book.read",
      resources: restricted.map(bookResource),
    });
    return {
      data: page.data.filter((book) => isPublicPublished(book) || decisions.get(book.id) === true),
      page: page.page,
    };
  }
}

function isPublicPublished(book: Book) {
  return book.visibility === "public" && book.status === "published";
}
