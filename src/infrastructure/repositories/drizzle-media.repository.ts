import { and, eq, or } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Media } from "@/domain/media/media.entity";
import type { MediaRepository } from "@/domain/media/media.repository";
import { media } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { mediaRowToEntity, mediaToInsertRow, mediaToUpdateRow } from "@/infrastructure/repositories/mappers/media.mapper";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

/**
 * Drizzle-backed media metadata repository. This intentionally persists only
 * metadata rows and never handles upload, image processing, or access checks.
 */
export class DrizzleMediaRepository implements MediaRepository {
  private readonly crud: CrudAdapter;

  constructor(db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async findMany(params: {
    limit: number;
    cursor?: string;
    includePrivateOwnedBy?: string | null;
    includePublicOnly: boolean;
  }) {
    const visibilityCondition = params.includePublicOnly
      ? [
          or(
            and(eq(media.visibility, "public"), eq(media.status, "ready")),
            params.includePrivateOwnedBy ? eq(media.owner, params.includePrivateOwnedBy) : undefined,
          )!,
        ]
      : undefined;

    const page = await this.crud.listRows<typeof media.$inferSelect>({
      table: media,
      idColumn: media.id,
      cursorColumn: media.createdAt,
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      limit: params.limit,
      cursor: params.cursor,
      where: visibilityCondition,
    });

    return { data: page.data.map(mediaRowToEntity), page: page.page };
  }

  async findById(id: string) {
    const row = await this.crud.findRowById<typeof media.$inferSelect>(media, media.id, id);
    return row ? mediaRowToEntity(row) : null;
  }

  async create(input: Media) {
    await this.crud.insertRow(media, mediaToInsertRow(input));
    return (await this.findById(input.id))!;
  }

  async update(input: Media) {
    await this.crud.updateRow(media, media.id, input.id, mediaToUpdateRow(input));
    return (await this.findById(input.id))!;
  }

  async delete(id: string) {
    return this.crud.deleteRowById(media, media.id, id);
  }
}
