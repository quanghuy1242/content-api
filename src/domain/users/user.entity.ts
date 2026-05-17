export type UserRole = "admin" | "user";

export type User = {
  id: string;
  email: string;
  fullName: string;
  avatar: string | null;
  bio: unknown | null;
  role: UserRole;
  betterAuthUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};
