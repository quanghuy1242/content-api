import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { User } from "@/domain/users/user.entity";
import type { UserRepository } from "@/domain/users/user.repository";
import { users } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { userRowToEntity, userToInsertRow, userToUpdateRow } from "@/infrastructure/repositories/mappers/user.mapper";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

/**
 * Drizzle-backed user repository. Local user IDs are the stable `id` subject;
 * field visibility stays in presenters and policies.
 */
export class DrizzleUserRepository implements UserRepository {
  private readonly crud: CrudAdapter;

  constructor(db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async findMany(params: { limit: number; cursor?: string }) {
    const page = await this.crud.listRows<typeof users.$inferSelect>({
      table: users,
      idColumn: users.id,
      cursorColumn: users.createdAt,
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      limit: params.limit,
      cursor: params.cursor,
    });

    return { data: page.data.map(userRowToEntity), page: page.page };
  }

  async findById(id: string) {
    const row = await this.crud.findRowById<typeof users.$inferSelect>(users, users.id, id);
    return row ? userRowToEntity(row) : null;
  }

  async findByEmail(email: string) {
    const row = await this.crud.findFirstRow<typeof users.$inferSelect>(users, eq(users.email, email));
    return row ? userRowToEntity(row) : null;
  }

  async create(user: User) {
    await this.crud.insertRow(users, userToInsertRow(user));
    return (await this.findById(user.id))!;
  }

  async save(user: User) {
    await this.crud.updateRow(users, users.id, user.id, userToUpdateRow(user));
  }

  async delete(id: string) {
    return this.crud.deleteRowById(users, users.id, id);
  }
}
