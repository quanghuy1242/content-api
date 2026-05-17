export type PostStatus = "draft" | "published";

export type PostProps = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: unknown;
  coverImage: string | null;
  author: string;
  category: string;
  tags: string[];
  status: PostStatus;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
};

export type CreatePostProps = Pick<
  PostProps,
  "id" | "title" | "slug" | "excerpt" | "content" | "coverImage" | "author" | "category" | "tags"
>;

export type UpdatePostProps = Partial<
  Pick<PostProps, "title" | "excerpt" | "content" | "coverImage" | "category" | "tags">
>;

/**
 * Domain model for the documented `posts` collection.
 *
 * The class owns lifecycle invariants such as draft-by-default creation,
 * publish/unpublish timestamps, and copy-on-read snapshots. Persistence mappers
 * are responsible for translating this model to Drizzle rows.
 */
export class Post {
  private constructor(private props: PostProps) {}

  /**
   * Creates a new draft post. Publishing is explicit because access checks and
   * publish timestamps happen through dedicated use cases.
   */
  static create(input: CreatePostProps) {
    const now = new Date();
    return new Post({
      ...input,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    });
  }

  static reconstitute(props: PostProps) {
    return new Post({ ...props, tags: [...props.tags] });
  }

  get id() { return this.props.id; }
  get title() { return this.props.title; }
  get slug() { return this.props.slug; }
  get excerpt() { return this.props.excerpt; }
  get content() { return this.props.content; }
  get coverImage() { return this.props.coverImage; }
  get author() { return this.props.author; }
  get category() { return this.props.category; }
  get tags() { return this.props.tags; }
  get status() { return this.props.status; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }
  get publishedAt() { return this.props.publishedAt; }

  update(input: UpdatePostProps) {
    if (input.title !== undefined) this.props.title = input.title;
    if (input.excerpt !== undefined) this.props.excerpt = input.excerpt;
    if (input.content !== undefined) this.props.content = input.content;
    if (input.coverImage !== undefined) this.props.coverImage = input.coverImage;
    if (input.category !== undefined) this.props.category = input.category;
    if (input.tags !== undefined) this.props.tags = input.tags;
    this.props.updatedAt = new Date();
  }

  publish() {
    if (!this.props.title || !this.props.slug) {
      throw new Error("Post cannot be published without title and slug");
    }

    this.props.status = "published";
    this.props.publishedAt = new Date();
    this.props.updatedAt = new Date();
  }

  unpublish() {
    this.props.status = "draft";
    this.props.publishedAt = null;
    this.props.updatedAt = new Date();
  }

  /**
   * Returns an immutable-ish snapshot for presenters and repository mappers.
   * Array values are cloned so callers cannot mutate entity state by reference.
   */
  toSnapshot(): PostProps {
    return {
      ...this.props,
      tags: [...this.props.tags],
    };
  }
}
