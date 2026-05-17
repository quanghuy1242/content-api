import type { z } from "zod";
import type { Media } from "@/domain/media/media.entity";
import type { mediaResponseSchema } from "@/http/schemas/media.schema";

/**
 * Presents media metadata only. Binary upload state is intentionally absent
 * because this API does not implement media upload or processing.
 */
export function presentMedia(media: Media): z.infer<typeof mediaResponseSchema> {
  const snapshot = media.toSnapshot();
  return {
    ...snapshot,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}
