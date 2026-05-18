import { z } from "zod";
import { MEDIA_UPLOAD_LIMITS } from "@/shared/constants";

const envSchema = z.object({
  AUTH_ISSUER: z.url(),
  AUTH_AUDIENCE: z.string().min(1),
  AUTH_JWKS_URL: z.url(),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  MAX_IMAGE_UPLOAD_BYTES: z.coerce.number().int().positive().default(MEDIA_UPLOAD_LIMITS.defaultMaxImageUploadBytes),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(MEDIA_UPLOAD_LIMITS.defaultUploadUrlTtlSeconds),
});

export type AppBindings = {
  DB: D1Database;
  MEDIA_R2: R2Bucket;
  IMAGES?: ImagesBinding;
  AUTH_ISSUER: string;
  AUTH_AUDIENCE: string;
  AUTH_JWKS_URL: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  MAX_IMAGE_UPLOAD_BYTES: string | number;
  UPLOAD_URL_TTL_SECONDS: string | number;
};

export function parseEnv(source: AppBindings) {
  return envSchema.parse(source);
}
