import { drizzle } from "drizzle-orm/d1";
import type { AppBindings } from "@/config/env";
import * as schema from "@/infrastructure/db/schema";

export function createDb(env: AppBindings) {
  return drizzle(env.DB, { schema });
}
