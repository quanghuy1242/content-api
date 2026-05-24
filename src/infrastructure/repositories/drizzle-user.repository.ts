import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { User, type IdentityProjectionUserProps } from "@/domain/users/user.entity";
import type { UserRepository } from "@/domain/users/user.repository";
import { users } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { userRowToEntity, userToInsertRow, userToUpdateRow } from "@/infrastructure/repositories/mappers/user.mapper";
import { ConflictError } from "@/shared/errors";

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

  async ensureIdentityProjection(input: IdentityProjectionUserProps) {
    const existing = await this.findById(input.id);
    if (existing) {
      if (existing.syncIdentityProjection(input)) {
        await this.save(existing);
      }
      return existing;
    }

    const fallbackEmail = `${input.id}@id.local.invalid`;
    const projected = User.create({
      id: input.id,
      email: input.email ?? fallbackEmail,
      fullName: input.fullName ?? input.email ?? fallbackEmail,
      avatar: input.avatar ?? null,
      bio: null,
      role: "user",
    });
    await this.crud.insertRow(users, userToInsertRow(projected), { onConflictDoNothing: true });
    const created = await this.findById(input.id);
    if (!created) throw new ConflictError("User identity projection conflicts with an existing local profile");
    return created;
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
