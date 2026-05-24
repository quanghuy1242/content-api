import type { z } from "zod";
import type { CreateMediaUploadResult } from "@/application/media/create-media-upload.usecase";
import type { Media } from "@/domain/media/media.entity";
import type { mediaResponseSchema, mediaUploadResponseSchema } from "@/http/schemas/media.schema";

export function presentMedia(media: Media): z.infer<typeof mediaResponseSchema> {
  const snapshot = media.toSnapshot();
  const response: z.infer<typeof mediaResponseSchema> = {
    id: snapshot.id,
    orgId: snapshot.orgId,
    alt: snapshot.alt,
    lowResUrl: snapshot.lowResUrl,
    optimizedUrl: snapshot.optimizedUrl,
    owner: snapshot.owner,
    url: snapshot.url,
    thumbnailURL: snapshot.thumbnailURL,
    filename: snapshot.filename,
    mimeType: snapshot.mimeType,
    filesize: snapshot.filesize,
    width: snapshot.width,
    height: snapshot.height,
    focalX: snapshot.focalX,
    focalY: snapshot.focalY,
    status: snapshot.status,
    visibility: snapshot.visibility,
    version: snapshot.version,
    failureReason: snapshot.failureReason,
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
