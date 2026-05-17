import type { DeferredGrant } from "@/domain/deferred-grants/deferred-grant.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface DeferredGrantRepository {
  findMany(params: { limit: number; cursor?: string }): Promise<CursorPage<DeferredGrant>>;
  findById(id: string): Promise<DeferredGrant | null>;
  create(input: DeferredGrant): Promise<DeferredGrant>;
  update(id: string, input: Partial<Omit<DeferredGrant, "id" | "createdAt">>): Promise<DeferredGrant | null>;
  delete(id: string): Promise<boolean>;
}
