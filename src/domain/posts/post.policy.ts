import type { Actor } from "@/domain/authz/actor";
import type { RelationshipRepository } from "@/domain/authz/relationship.repository";
import type { Post } from "@/domain/posts/post.entity";

/**
 * ReBAC policy for posts. Public reads are status based; draft and mutation
 * access depends on admin role or persisted `author` relationships.
 */
export class PostPolicy {
  constructor(private readonly relationships: RelationshipRepository) {}

  canCreate(actor: Actor | null) {
    return Promise.resolve(actor?.type === "user");
  }

  canRead(actor: Actor | null, post: Post) {
    if (post.status === "published") return Promise.resolve(true);
    if (actor?.type !== "user") return Promise.resolve(false);
    if (actor.role === "admin") return Promise.resolve(true);

    return this.relationships.exists({
      subjectType: "user",
      subjectId: actor.localUserId ?? actor.id,
      relation: "author",
      objectType: "post",
      objectId: post.id,
    });
  }

  canUpdate(actor: Actor | null, post: Post) {
    if (actor?.type !== "user") return Promise.resolve(false);
    if (actor.role === "admin") return Promise.resolve(true);

    return this.relationships.exists({
      subjectType: "user",
      subjectId: actor.localUserId ?? actor.id,
      relation: "author",
      objectType: "post",
      objectId: post.id,
    });
  }

  canDelete(actor: Actor | null, post: Post) {
    return this.canUpdate(actor, post);
  }

  canPublish(actor: Actor | null, post: Post) {
    return this.canUpdate(actor, post);
  }

  canUnpublish(actor: Actor | null, post: Post) {
    return this.canUpdate(actor, post);
  }
}
