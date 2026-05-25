import { assertAllowed } from "@/domain/auth/assert-can";
import type { Actor } from "@/domain/auth/actor";
import { requireContentScope } from "@/domain/auth/scopes";
import type { LifecycleCapable } from "@/domain/lifecycle/lifecycle-entity";
import type { LifecycleManager } from "@/domain/lifecycle/lifecycle-manager";
import { NotFoundError, ValidationError } from "@/shared/errors";

/** draft → scheduled, with a future publish timestamp committed to the entity. */
export class SchedulePublishUseCase<T extends LifecycleCapable> {
  constructor(
    private readonly manager: LifecycleManager<T>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(params: { actor: Actor; id: string; scheduledAt: Date }): Promise<T> {
    requireContentScope(params.actor, "content:write");
    if (params.scheduledAt.getTime() <= this.clock().getTime()) {
      throw new ValidationError("scheduledAt must be in the future");
    }
    const entity = await this.manager.findById(params.id);
    if (!entity) throw new NotFoundError(`${this.manager.resourceType} not found`);

    await assertAllowed(
      this.manager.canSchedule(params.actor, entity),
      `You cannot schedule this ${this.manager.resourceType}`,
    );

    entity.schedule(params.scheduledAt);
    await this.manager.save(entity);
    return entity;
  }
}
