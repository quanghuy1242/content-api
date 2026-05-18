import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { DeferredGrant } from "@/domain/deferred-grants/deferred-grant.entity";
import type { DeferredGrantRepository } from "@/domain/deferred-grants/deferred-grant.repository";
import { deferredGrants } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import {
  deferredGrantRowToEntity,
  deferredGrantToInsertRow,
  deferredGrantToUpdateRow,
} from "@/infrastructure/repositories/mappers/deferred-grant.mapper";
import * as schema from "@/infrastructure/db/schema";

type Db = DrizzleD1Database<typeof schema>;

/**
 * Drizzle-backed deferred-grant repository for grant reconciliation state.
 * It contains persistence mapping only; admin/system access is enforced by
 * `DeferredGrantPolicy` and use cases.
 */
export class DrizzleDeferredGrantRepository implements DeferredGrantRepository {
  private readonly crud: CrudAdapter;

  constructor(db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async findMany(params: { limit: number; cursor?: string }) {
    const page = await this.crud.listRows<typeof deferredGrants.$inferSelect>({
      table: deferredGrants,
      idColumn: deferredGrants.id,
      cursorColumn: deferredGrants.createdAt,
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      limit: params.limit,
      cursor: params.cursor,
    });

    return { data: page.data.map(deferredGrantRowToEntity), page: page.page };
  }

  async findById(id: string) {
    const row = await this.crud.findRowById<typeof deferredGrants.$inferSelect>(deferredGrants, deferredGrants.id, id);
    return row ? deferredGrantRowToEntity(row) : null;
  }

  async create(input: DeferredGrant) {
    await this.crud.insertRow(deferredGrants, deferredGrantToInsertRow(input));
    return (await this.findById(input.id))!;
  }

  async save(grant: DeferredGrant) {
    await this.crud.updateRow(deferredGrants, deferredGrants.id, grant.id, deferredGrantToUpdateRow(grant));
  }

  async delete(id: string) {
    return this.crud.deleteRowById(deferredGrants, deferredGrants.id, id);
  }
}
