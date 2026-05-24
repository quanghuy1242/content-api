import type { PolicyEvent } from "@/domain/iam/policy-event.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface PolicyEventRepository {
  findMany(params: { targetType: string; targetId: string; limit: number; cursor?: string }): Promise<CursorPage<PolicyEvent>>;
  create(event: PolicyEvent): Promise<PolicyEvent>;
}
