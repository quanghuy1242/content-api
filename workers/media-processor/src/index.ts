import { drizzle } from "drizzle-orm/d1";
import { CloudflareImagesService } from "@/infrastructure/images/cloudflare-images-service";
import { DrizzleMediaRepository } from "@/infrastructure/repositories/drizzle-media.repository";
import { R2ObjectStorage } from "@/infrastructure/storage/r2-object-storage";
import { GenerateMediaDerivativesUseCase } from "@/application/media/generate-media-derivatives.usecase";
import { ProcessMediaUploadUseCase } from "@/application/media/process-media-upload.usecase";
import { parseMediaProcessorEnv, type MediaProcessorEnv } from "./config";
import * as schema from "@/infrastructure/db/schema";

type R2ObjectCreatedEvent = {
  action: "PutObject" | "CopyObject" | "CompleteMultipartUpload";
  object?: {
    key?: string;
    size?: number;
  };
};

export function createMediaProcessorQueueHandler(
  processObjectCreated: (input: { key: string; size?: number }) => Promise<unknown>,
) {
  return async function queue(batch: MessageBatch<R2ObjectCreatedEvent>, _env: unknown, _ctx: ExecutionContext) {
    await Promise.all(batch.messages.map(async (message) => {
      const body = message.body;
      const key = body.object?.key;
      if (!key || !key.startsWith("media/") || !key.endsWith("/original")) {
        message.ack();
        return;
      }
      if (!["PutObject", "CopyObject", "CompleteMultipartUpload"].includes(body.action)) {
        message.ack();
        return;
      }

      try {
        await processObjectCreated({ key, size: body.object?.size });
        message.ack();
      } catch {
        message.retry();
      }
    }));
  };
}

export default {
  async queue(batch: MessageBatch<R2ObjectCreatedEvent>, env: MediaProcessorEnv, ctx: ExecutionContext) {
    parseMediaProcessorEnv(env);

    const db = drizzle(env.DB, { schema });
    const mediaRepository = new DrizzleMediaRepository(db);
    const storage = new R2ObjectStorage(env.MEDIA_R2);
    const images = new CloudflareImagesService(env.IMAGES);
    const derivatives = new GenerateMediaDerivativesUseCase(images, storage);
    const processObjectCreated = new ProcessMediaUploadUseCase(mediaRepository, storage, derivatives);

    return createMediaProcessorQueueHandler((input) => processObjectCreated.execute(input))(batch, env, ctx);
  },
};
