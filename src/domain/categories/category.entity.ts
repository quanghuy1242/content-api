import { slugify } from "@/shared/validation/fields";

export type CategoryProps = {
  id: string;
  name: string;
  slug: string;
  description: string;
  image: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateCategoryProps = Omit<CategoryProps, "id" | "slug" | "createdAt" | "updatedAt">;

export type UpdateCategoryProps = Partial<
  Pick<CategoryProps, "name" | "description" | "image">
>;

export class Category {
  private constructor(private props: CategoryProps) {}

  static create(input: CreateCategoryProps) {
    const now = new Date();
    return new Category({
      ...input,
      id: crypto.randomUUID(),
      slug: slugify(input.name),
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: CategoryProps) {
    return new Category({ ...props });
  }

  get id() { return this.props.id; }
  get name() { return this.props.name; }
  get slug() { return this.props.slug; }
  get description() { return this.props.description; }
  get image() { return this.props.image; }
  get createdBy() { return this.props.createdBy; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }

  update(input: UpdateCategoryProps) {
    if (input.name !== undefined) this.props.name = input.name;
    if (input.description !== undefined) this.props.description = input.description;
    if (input.image !== undefined) this.props.image = input.image;
    this.touch();
  }

  toSnapshot(): CategoryProps {
    return { ...this.props };
  }

  private touch() {
    this.props.updatedAt = new Date();
  }
}
