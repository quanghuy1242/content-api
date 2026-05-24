import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Book } from "@/domain/books/book.entity";
import type { BookRepository } from "@/domain/books/book.repository";
import { books } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { bookRowToEntity, bookToInsertRow } from "@/infrastructure/repositories/mappers/content-iam.mapper";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

export class DrizzleBookRepository implements BookRepository {
  private readonly crud: CrudAdapter;

  constructor(db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async findById(id: string) {
    const row = await this.crud.findRowById<typeof books.$inferSelect>(books, books.id, id);
    return row ? bookRowToEntity(row) : null;
  }

  async create(book: Book) {
    await this.crud.insertRow(books, bookToInsertRow(book));
    return (await this.findById(book.id))!;
  }
}
