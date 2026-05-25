import type { AppBindings } from "@/config/env";
import { buildScheduledLifecycleManagers, runScheduledPublish } from "@/composition/scheduled-lifecycle";

export default {
  async scheduled(event: ScheduledController, env: AppBindings, ctx: ExecutionContext) {
    const managers = buildScheduledLifecycleManagers(env);
    ctx.waitUntil(runScheduledPublish(managers, new Date(event.scheduledTime)));
  },
} satisfies ExportedHandler<AppBindings>;
