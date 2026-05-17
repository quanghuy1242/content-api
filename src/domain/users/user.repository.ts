import type { User } from "@/domain/users/user.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface UserRepository {
  findMany(params: { limit: number; cursor?: string }): Promise<CursorPage<User>>;
  findById(id: string): Promise<User | null>;
  findByBetterAuthUserId(betterAuthUserId: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(input: Omit<User, "createdAt" | "updatedAt">): Promise<User>;
  update(id: string, input: Partial<Omit<User, "id" | "createdAt" | "updatedAt">>): Promise<User | null>;
  delete(id: string): Promise<boolean>;
}
