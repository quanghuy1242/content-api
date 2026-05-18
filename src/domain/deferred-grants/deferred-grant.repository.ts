import type { DeferredGrant } from "@/domain/deferred-grants/deferred-grant.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface DeferredGrantRepository {
  findMany(params: { limit: number; cursor?: string }): Promise<CursorPage<DeferredGrant>>;
  findById(id: string): Promise<DeferredGrant | null>;
  create(input: DeferredGrant): Promise<DeferredGrant>;
  save(grant: DeferredGrant): Promise<void>;
  delete(id: string): Promise<boolean>;
}
