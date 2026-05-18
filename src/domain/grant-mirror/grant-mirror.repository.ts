import type { GrantMirror } from "@/domain/grant-mirror/grant-mirror.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface GrantMirrorRepository {
  findMany(params: { limit: number; cursor?: string }): Promise<CursorPage<GrantMirror>>;
  findById(id: string): Promise<GrantMirror | null>;
  create(input: GrantMirror): Promise<GrantMirror>;
  save(mirror: GrantMirror): Promise<void>;
  delete(id: string): Promise<boolean>;
}
