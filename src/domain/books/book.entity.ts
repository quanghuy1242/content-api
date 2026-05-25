import type { LifecycleCapable, LifecycleStatus } from "@/domain/lifecycle/lifecycle-entity";
import { ConflictError } from "@/shared/errors";

export type BookVisibility = "private" | "public";
export type BookStatus = "draft" | "scheduled" | "published" | "archived";

export type BookProps = {
  id: string;
  orgId: string;
  title: string;
  createdByUserId: string;
  visibility: BookVisibility;
  status: BookStatus;
  publishedAt: Date | null;
  scheduledAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateBookProps = Omit<BookProps, "id" | "visibility" | "status" | "publishedAt" | "scheduledAt" | "archivedAt" | "createdAt" | "updatedAt">;

/** status is intentionally excluded — lifecycle transitions go through dedicated endpoints. */
export type UpdateBookProps = Partial<Pick<BookProps, "title" | "visibility">>;

/** Root collaborative content resource whose owner is represented by Content IAM. */
export class Book implements LifecycleCapable {
  private constructor(private props: BookProps) {}

  static create(input: CreateBookProps) {
    const now = new Date();
    return new Book({
      ...input,
      id: crypto.randomUUID(),
      visibility: "private",
      status: "draft",
      publishedAt: null,
      scheduledAt: null,
      archivedAt: null,
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
  get lifecycleStatus(): LifecycleStatus { return this.props.status; }
  get publishedAt() { return this.props.publishedAt; }
  get scheduledAt() { return this.props.scheduledAt; }
  get archivedAt() { return this.props.archivedAt; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }

  update(input: UpdateBookProps) {
    if (this.props.status === "archived") throw new ConflictError("Cannot update an archived book");
    if (input.title !== undefined) this.props.title = input.title;
    if (input.visibility !== undefined) this.props.visibility = input.visibility;
    this.props.updatedAt = new Date();
  }

  publish() {
    if (this.props.status === "archived") throw new ConflictError("Cannot publish an archived book");
    if (this.props.status === "published") throw new ConflictError("Book is already published");
    this.props.status = "published";
    this.props.publishedAt = new Date();
    this.props.scheduledAt = null;
    this.props.updatedAt = new Date();
  }

  unpublish() {
    if (this.props.status === "archived") throw new ConflictError("Cannot unpublish an archived book");
    if (this.props.status === "draft") throw new ConflictError("Book is already a draft");
    this.props.status = "draft";
    this.props.publishedAt = null;
    this.props.scheduledAt = null;
    this.props.updatedAt = new Date();
  }

  schedule(scheduledAt: Date) {
    if (this.props.status !== "draft") throw new ConflictError(`Cannot schedule a ${this.props.status} book`);
    this.props.status = "scheduled";
    this.props.scheduledAt = scheduledAt;
    this.props.updatedAt = new Date();
  }

  archive() {
    if (this.props.status === "archived") throw new ConflictError("Book is already archived");
    this.props.status = "archived";
    this.props.archivedAt = new Date();
    this.props.scheduledAt = null;
    this.props.updatedAt = new Date();
  }

  toSnapshot(): BookProps {
    return { ...this.props };
  }
}
