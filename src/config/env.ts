import { z } from "zod";

const envSchema = z.object({
  AUTH_ISSUER: z.url(),
  AUTH_AUDIENCE: z.string().min(1),
  AUTH_JWKS_URL: z.url(),
});

export type AppBindings = {
  DB: D1Database;
  AUTH_ISSUER: string;
  AUTH_AUDIENCE: string;
  AUTH_JWKS_URL: string;
};

export function parseEnv(source: AppBindings) {
  return envSchema.parse(source);
}
