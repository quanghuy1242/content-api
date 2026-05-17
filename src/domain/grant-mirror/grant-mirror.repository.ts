import type { GrantMirror } from "@/domain/grant-mirror/grant-mirror.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface GrantMirrorRepository {
  findMany(params: { limit: number; cursor?: string }): Promise<CursorPage<GrantMirror>>;
  findById(id: string): Promise<GrantMirror | null>;
  create(input: GrantMirror): Promise<GrantMirror>;
  update(id: string, input: Partial<Omit<GrantMirror, "id">>): Promise<GrantMirror | null>;
  delete(id: string): Promise<boolean>;
}
