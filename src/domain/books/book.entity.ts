export type BookVisibility = "private" | "public";
export type BookStatus = "draft" | "published" | "archived";

export type BookProps = {
  id: string;
  orgId: string;
  title: string;
  createdByUserId: string;
  visibility: BookVisibility;
  status: BookStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateBookProps = Omit<BookProps, "id" | "visibility" | "status" | "createdAt" | "updatedAt">;

export class Book {
  private constructor(private props: BookProps) {}

  static create(input: CreateBookProps) {
    const now = new Date();
    return new Book({
      ...input,
      id: crypto.randomUUID(),
      visibility: "private",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: BookProps) {
    return new Book({ ...props });
  }

  get id() { return this.props.id; }
  get orgId() { return this.props.orgId; }
  get title() { return this.props.title; }
  get createdByUserId() { return this.props.createdByUserId; }
  get visibility() { return this.props.visibility; }
  get status() { return this.props.status; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }

  toSnapshot(): BookProps {
    return { ...this.props };
  }
}
