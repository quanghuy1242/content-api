import { Post, type PostProps } from "@/domain/posts/post.entity";
import { posts } from "@/infrastructure/db/schema";

type PostRow = typeof posts.$inferSelect;

function parseContentJson(value: unknown) {
  const payload = (value ?? {}) as { content?: unknown; tags?: unknown };
  return {
    content: Object.hasOwn(payload, "content") ? payload.content : value,
    tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === "string") : [],
  };
}

function serializePostContent(post: Post) {
  const snapshot = post.toSnapshot();
  return {
    content: snapshot.content,
    tags: snapshot.tags,
  };
}

/**
 * Reconstitutes a post row, including the documented `content_json` packing of
 * rich content and tags, into the domain entity.
 */
export function postRowToEntity(row: PostRow): Post {
  const content = parseContentJson(row.contentJson);
  return Post.reconstitute({
    id: row.id,
    orgId: row.orgId,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    content: content.content,
    coverImage: row.coverImage,
    author: row.author,
    category: row.category,
    tags: content.tags,
    status: row.status as PostProps["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
    scheduledAt: row.scheduledAt ?? null,
    archivedAt: row.archivedAt ?? null,
  });
}

/**
 * Packs post rich content and tags into the Drizzle row shape for inserts.
 */
export function postToInsertRow(post: Post) {
  const snapshot = post.toSnapshot();
  return {
    id: snapshot.id,
    orgId: snapshot.orgId,
    title: snapshot.title,
    slug: snapshot.slug,
    excerpt: snapshot.excerpt,
    contentJson: serializePostContent(post),
    coverImage: snapshot.coverImage,
    author: snapshot.author,
    category: snapshot.category,
    status: snapshot.status,
    publishedAt: snapshot.publishedAt,
    scheduledAt: snapshot.scheduledAt,
    archivedAt: snapshot.archivedAt,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

/**
 * Packs post mutable state into the Drizzle row shape for updates.
 */
export function postToUpdateRow(post: Post) {
  const snapshot = post.toSnapshot();
  return {
    title: snapshot.title,
    excerpt: snapshot.excerpt,
    contentJson: serializePostContent(post),
    coverImage: snapshot.coverImage,
    category: snapshot.category,
    updatedAt: snapshot.updatedAt,
  };
}

/** Maps only entity-owned lifecycle state for guarded lifecycle transitions. */
export function postToLifecycleUpdateRow(post: Post) {
  const snapshot = post.toSnapshot();
  return {
    status: snapshot.status,
    publishedAt: snapshot.publishedAt,
    scheduledAt: snapshot.scheduledAt,
    archivedAt: snapshot.archivedAt,
    updatedAt: snapshot.updatedAt,
  };
}
