import { z } from "zod";

const envSchema = z.object({
  DB: z.custom<D1Database>(),
  MEDIA_R2: z.custom<R2Bucket>(),
  IMAGES: z.custom<ImagesBinding>(),
});

export type MediaProcessorEnv = z.infer<typeof envSchema>;

export function parseMediaProcessorEnv(env: MediaProcessorEnv) {
  return envSchema.parse(env);
}
