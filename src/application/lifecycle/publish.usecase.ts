import { assertAllowed } from "@/domain/auth/assert-can";
import type { Actor } from "@/domain/auth/actor";
import { requireContentScope } from "@/domain/auth/scopes";
import type { LifecycleCapable } from "@/domain/lifecycle/lifecycle-entity";
import type { LifecycleManager } from "@/domain/lifecycle/lifecycle-manager";
import { NotFoundError } from "@/shared/errors";

/** draft|scheduled → published, manually triggered by an authenticated actor. */
export class PublishUseCase<T extends LifecycleCapable> {
  constructor(private readonly manager: LifecycleManager<T>) {}

  async execute(params: { actor: Actor; id: string }): Promise<T> {
    requireContentScope(params.actor, "content:write");
    const entity = await this.manager.findById(params.id);
    if (!entity) throw new NotFoundError(`${this.manager.resourceType} not found`);

    await assertAllowed(
      this.manager.canPublish(params.actor, entity),
      `You cannot publish this ${this.manager.resourceType}`,
    );

    const expectedStatus = entity.lifecycleStatus;
    entity.publish();
    await this.manager.save(entity, expectedStatus);
    return entity;
  }
}
