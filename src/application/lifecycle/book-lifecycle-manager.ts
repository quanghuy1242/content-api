import type { Actor } from "@/domain/auth/actor";
import type { Book } from "@/domain/books/book.entity";
import type { BookRepository } from "@/domain/books/book.repository";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { bookResource } from "@/domain/iam/resource-loader";
import type { LifecycleManager } from "@/domain/lifecycle/lifecycle-manager";

export class BookLifecycleManager implements LifecycleManager<Book> {
  readonly resourceType = "book";

  constructor(
    private readonly books: BookRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  findById(id: string) { return this.books.findById(id); }
  save(entity: Book) { return this.books.save(entity); }

  canPublish(actor: Actor, entity: Book) {
    return this.contentPolicy.can({ actor, permission: "book.publish", resource: bookResource(entity) });
  }
  canUnpublish(actor: Actor, entity: Book) {
    return this.contentPolicy.can({ actor, permission: "book.publish", resource: bookResource(entity) });
  }
  canSchedule(actor: Actor, entity: Book) {
    return this.contentPolicy.can({ actor, permission: "book.publish", resource: bookResource(entity) });
  }
  canArchive(actor: Actor, entity: Book) {
    return this.contentPolicy.can({ actor, permission: "book.archive", resource: bookResource(entity) });
  }

  findScheduledReadyIds(now: Date, limit: number) {
    return this.books.findScheduledReadyIds(now, limit);
  }
  publishScheduledReady(id: string, now: Date) {
    return this.books.publishScheduledReady(id, now);
  }
}
