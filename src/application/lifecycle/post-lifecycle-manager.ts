import type { Actor } from "@/domain/auth/actor";
import type { ContentPolicy } from "@/domain/iam/content-policy";
import { postResource } from "@/domain/iam/resource-loader";
import type { LifecycleStatus } from "@/domain/lifecycle/lifecycle-entity";
import type { LifecycleManager } from "@/domain/lifecycle/lifecycle-manager";
import type { Post } from "@/domain/posts/post.entity";
import type { PostRepository } from "@/domain/posts/post.repository";

export class PostLifecycleManager implements LifecycleManager<Post> {
  readonly resourceType = "post";

  constructor(
    private readonly posts: PostRepository,
    private readonly contentPolicy: ContentPolicy,
  ) {}

  findById(id: string) { return this.posts.findById(id); }
  save(entity: Post, expectedStatus: LifecycleStatus) { return this.posts.saveLifecycle(entity, expectedStatus); }

  canPublish(actor: Actor, entity: Post) {
    return this.contentPolicy.can({ actor, permission: "post.publish", resource: postResource(entity) });
  }
  canUnpublish(actor: Actor, entity: Post) {
    return this.contentPolicy.can({ actor, permission: "post.publish", resource: postResource(entity) });
  }
  canSchedule(actor: Actor, entity: Post) {
    return this.contentPolicy.can({ actor, permission: "post.publish", resource: postResource(entity) });
  }
  canArchive(actor: Actor, entity: Post) {
    return this.contentPolicy.can({ actor, permission: "post.archive", resource: postResource(entity) });
  }

  findScheduledReadyIds(now: Date, limit: number) {
    return this.posts.findScheduledReadyIds(now, limit);
  }
  publishScheduledReady(id: string, now: Date) {
    return this.posts.publishScheduledReady(id, now);
  }
}
