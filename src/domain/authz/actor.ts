export type UserActor = {
  type: "user";
  id: string;
  externalId: string;
  role: "admin" | "user";
  email?: string;
  localUserId?: string;
};

export type ApiKeyActor = {
  type: "api_key";
  id: string;
  scopes: string[];
};

export type SystemActor = {
  type: "system";
  id: "queue" | "cron" | "migration";
};

export type Actor = UserActor | ApiKeyActor | SystemActor;

export function isAdminActor(actor: Actor | null): actor is UserActor {
  return actor?.type === "user" && actor.role === "admin";
}
