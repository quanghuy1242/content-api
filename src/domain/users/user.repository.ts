import type { User } from "@/domain/users/user.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface UserRepository {
  findMany(params: { limit: number; cursor?: string }): Promise<CursorPage<User>>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(user: User): Promise<User>;
  save(user: User): Promise<void>;
  delete(id: string): Promise<boolean>;
}
