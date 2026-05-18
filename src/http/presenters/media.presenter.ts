import type { z } from "zod";
import type { CreateMediaUploadResult } from "@/application/media/create-media-upload.usecase";
import type { Media } from "@/domain/media/media.entity";
import type { mediaResponseSchema, mediaUploadResponseSchema } from "@/http/schemas/media.schema";

export function presentMedia(media: Media): z.infer<typeof mediaResponseSchema> {
  const snapshot = media.toSnapshot();
  const response: z.infer<typeof mediaResponseSchema> = {
    ...snapshot,
    uploadExpiresAt: snapshot.uploadExpiresAt?.toISOString() ?? null,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };

  if (media.status === "ready") {
    response.variantUrls = Object.fromEntries(
      Object.keys(snapshot.variantKeys).map((name) => [name, `/media/${media.id}/v/${media.version}/variants/${name}`]),
    );
  }

  return response;
}

export function presentMediaUploadResult(result: CreateMediaUploadResult): z.infer<typeof mediaUploadResponseSchema> {
  return {
    media: presentMedia(result.media),
    upload: result.upload,
  };
}
