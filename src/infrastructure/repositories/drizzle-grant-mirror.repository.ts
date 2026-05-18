import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { GrantMirror } from "@/domain/grant-mirror/grant-mirror.entity";
import type { GrantMirrorRepository } from "@/domain/grant-mirror/grant-mirror.repository";
import { grantMirror } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import {
  grantMirrorRowToEntity,
  grantMirrorToInsertRow,
  grantMirrorToUpdateRow,
} from "@/infrastructure/repositories/mappers/grant-mirror.mapper";
import * as schema from "@/infrastructure/db/schema";

type Db = DrizzleD1Database<typeof schema>;

/**
 * Drizzle-backed repository for mirrored Auther grants. It persists mirror
 * state only; live permission decisions remain outside infrastructure.
 */
export class DrizzleGrantMirrorRepository implements GrantMirrorRepository {
  private readonly crud: CrudAdapter;

  constructor(db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async findMany(params: { limit: number; cursor?: string }) {
    const page = await this.crud.listRows<typeof grantMirror.$inferSelect>({
      table: grantMirror,
      idColumn: grantMirror.id,
      cursorColumn: grantMirror.syncedAt,
      getCursor: (row) => ({ createdAt: row.syncedAt, id: row.id }),
      limit: params.limit,
      cursor: params.cursor,
    });

    return { data: page.data.map(grantMirrorRowToEntity), page: page.page };
  }

  async findById(id: string) {
    const row = await this.crud.findRowById<typeof grantMirror.$inferSelect>(grantMirror, grantMirror.id, id);
    return row ? grantMirrorRowToEntity(row) : null;
  }

  async create(input: GrantMirror) {
    await this.crud.insertRow(grantMirror, grantMirrorToInsertRow(input));
    return (await this.findById(input.id))!;
  }

  async save(mirror: GrantMirror) {
    await this.crud.updateRow(grantMirror, grantMirror.id, mirror.id, grantMirrorToUpdateRow(mirror));
  }

  async delete(id: string) {
    return this.crud.deleteRowById(grantMirror, grantMirror.id, id);
  }
}
