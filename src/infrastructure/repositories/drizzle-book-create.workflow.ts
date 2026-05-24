import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { BookCreateWorkflow } from "@/domain/books/book-create.workflow";
import { books, contentPolicyBindings, contentPolicyEvents, idempotencyKeys } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { isSqliteUniqueConstraintError } from "@/infrastructure/persistence/sqlite-errors";
import { bookToInsertRow } from "@/infrastructure/repositories/mappers/book.mapper";
import { policyBindingToInsertRow, policyEventToInsertRow } from "@/infrastructure/repositories/mappers/content-iam.mapper";
import { idempotencyToInsertRow } from "@/infrastructure/repositories/mappers/idempotency.mapper";
import { ConflictError, IdempotencyReservationConflictError } from "@/shared/errors";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

/** Commits a new root book, direct owner, audit event, and replay record together. */
export class DrizzleBookCreateWorkflow implements BookCreateWorkflow {
  private readonly crud: CrudAdapter;

  constructor(private readonly db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async createWithOwner(params: Parameters<BookCreateWorkflow["createWithOwner"]>[0]) {
    try {
      await this.db.batch([
        this.crud.buildInsert(idempotencyKeys, idempotencyToInsertRow(params.idempotency)),
        this.crud.buildInsert(books, bookToInsertRow(params.book)),
        this.crud.buildInsert(contentPolicyBindings, policyBindingToInsertRow(params.ownerBinding)),
        this.crud.buildInsert(contentPolicyEvents, policyEventToInsertRow(params.event)),
      ]);
    } catch (error) {
      if (isSqliteUniqueConstraintError(error, "idempotency_keys.key")) {
        throw new IdempotencyReservationConflictError();
      }
      if (isSqliteUniqueConstraintError(error)) {
        throw new ConflictError("Book creation state already exists or changed concurrently");
      }
      throw error;
    }
  }
}
