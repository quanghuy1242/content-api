import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Book } from "@/domain/books/book.entity";
import type { BookRepository } from "@/domain/books/book.repository";
import { books } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { bookRowToEntity, bookToUpdateRow } from "@/infrastructure/repositories/mappers/book.mapper";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

export class DrizzleBookRepository implements BookRepository {
  private readonly crud: CrudAdapter;

  constructor(db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async findMany(params: { limit: number; cursor?: string }) {
    const page = await this.crud.listRows<typeof books.$inferSelect>({
      table: books,
      idColumn: books.id,
      cursorColumn: books.createdAt,
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      limit: params.limit,
      cursor: params.cursor,
    });
    return { data: page.data.map(bookRowToEntity), page: page.page };
  }

  async findById(id: string) {
    const row = await this.crud.findRowById<typeof books.$inferSelect>(books, books.id, id);
    return row ? bookRowToEntity(row) : null;
  }

  async save(book: Book) {
    await this.crud.updateRow(books, books.id, book.id, bookToUpdateRow(book));
  }
}
