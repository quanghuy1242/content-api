import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { PolicyEvent } from "@/domain/iam/policy-event.entity";
import type { PolicyEventRepository } from "@/domain/iam/policy-event.repository";
import { contentPolicyEvents } from "@/infrastructure/db/schema";
import { CrudAdapter } from "@/infrastructure/persistence/crud-adapter";
import { policyEventRowToEntity, policyEventToInsertRow } from "@/infrastructure/repositories/mappers/content-iam.mapper";

type Db = DrizzleD1Database<typeof import("@/infrastructure/db/schema")>;

/** Drizzle repository for append-only Content IAM audit events. */
export class DrizzlePolicyEventRepository implements PolicyEventRepository {
  private readonly crud: CrudAdapter;

  constructor(db: Db) {
    this.crud = new CrudAdapter(db);
  }

  async findMany(params: { targetType: string; targetId: string; limit: number; cursor?: string }) {
    const page = await this.crud.listRows<typeof contentPolicyEvents.$inferSelect>({
      table: contentPolicyEvents,
      idColumn: contentPolicyEvents.id,
      cursorColumn: contentPolicyEvents.createdAt,
      getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
      limit: params.limit,
      cursor: params.cursor,
      where: [
        eq(contentPolicyEvents.targetType, params.targetType),
        eq(contentPolicyEvents.targetId, params.targetId),
      ],
    });
    return { data: page.data.map(policyEventRowToEntity), page: page.page };
  }

  async create(event: PolicyEvent) {
    await this.crud.insertRow(contentPolicyEvents, policyEventToInsertRow(event));
    return event;
  }
}
