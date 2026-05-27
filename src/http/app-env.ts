import type { AppBindings } from "@/config/env";
import type { Actor } from "@/domain/auth/actor";
import type { createRequestContainer } from "@/composition/create-request-container";

export type AppContainer = ReturnType<typeof createRequestContainer>;

export type AppEnv = {
  Bindings: AppBindings;
  Variables: {
    requestId: string;
    actor: Actor | null;
    bearerToken: string | null;
    container: AppContainer;
  };
};
