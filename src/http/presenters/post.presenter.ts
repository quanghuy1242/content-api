import type { z } from "zod";
import type { Post } from "@/domain/posts/post.entity";
import type { postResponseSchema } from "@/http/schemas/posts.schema";

/**
 * Presents the post domain model using the documented JSON contract.
 */
export function presentPost(post: Post): z.infer<typeof postResponseSchema> {
  const payload = post.toSnapshot();
  return {
    ...payload,
    publishedAt: payload.publishedAt?.toISOString() ?? null,
    scheduledAt: payload.scheduledAt?.toISOString() ?? null,
    archivedAt: payload.archivedAt?.toISOString() ?? null,
    createdAt: payload.createdAt.toISOString(),
    updatedAt: payload.updatedAt.toISOString(),
  };
}
