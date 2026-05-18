export type UserRole = "admin" | "user";

export type UserProps = {
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

export type CreateUserProps = Omit<UserProps, "id" | "createdAt" | "updatedAt">;

export type UpdateUserProps = Partial<Omit<UserProps, "id" | "createdAt" | "updatedAt" | "betterAuthUserId">>;

export class User {
  private constructor(private props: UserProps) {}

  static create(input: CreateUserProps) {
    const now = new Date();
    return new User({
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: UserProps) {
    return new User({ ...props });
  }

  get id() { return this.props.id; }
  get email() { return this.props.email; }
  get fullName() { return this.props.fullName; }
  get avatar() { return this.props.avatar; }
  get bio() { return this.props.bio; }
  get role() { return this.props.role; }
  get betterAuthUserId() { return this.props.betterAuthUserId; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }

  update(input: UpdateUserProps) {
    if (input.email !== undefined) this.props.email = input.email;
    if (input.fullName !== undefined) this.props.fullName = input.fullName;
    if (input.avatar !== undefined) this.props.avatar = input.avatar;
    if (input.bio !== undefined) this.props.bio = input.bio;
    if (input.role !== undefined) this.props.role = input.role;
    this.touch();
  }

  toSnapshot(): UserProps {
    return { ...this.props };
  }

  private touch() {
    this.props.updatedAt = new Date();
  }
}
