export type UserActor = {
  type: "user";
  id: string;
  subject: string;
  role: "admin" | "user";
  scopes: readonly string[];
  organizationId?: string;
  teamIds: readonly string[];
  email?: string;
  name?: string;
  avatar?: string;
};

export type ServiceAccountActor = {
  type: "service_account";
  clientId: string;
  organizationId: string;
  scopes: readonly string[];
};

export type SystemActor = {
  type: "system";
  id: "queue" | "cron" | "migration";
};

export type Actor = UserActor | ServiceAccountActor | SystemActor;

export function isAdminActor(actor: Actor | null): boolean {
  return actor?.type === "user" && actor.role === "admin";
}
