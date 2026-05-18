import { isImageValidationError } from "@/domain/media/image-service";
import type { Media } from "@/domain/media/media.entity";
import type { MediaRepository } from "@/domain/media/media.repository";
import type { ObjectStorage } from "@/domain/media/object-storage";
import { GenerateMediaDerivativesUseCase } from "@/application/media/generate-media-derivatives.usecase";
import { MEDIA_TERMINAL_STATUSES } from "@/shared/constants";

type ProcessOutcome =
  | { outcome: "skipped"; reason: "missing_media" | "already_processed" | "key_mismatch" }
  | { outcome: "expired" }
  | { outcome: "failed" }
  | { outcome: "ready" };

export class ProcessMediaUploadUseCase {
  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly storage: ObjectStorage,
    private readonly derivatives: GenerateMediaDerivativesUseCase,
  ) {}

  async execute(params: { key: string; size?: number }): Promise<ProcessOutcome> {
    const media = await this.mediaRepository.findByOriginalKey(params.key);
    if (!media) {
      return { outcome: "skipped", reason: "missing_media" };
    }
    if (MEDIA_TERMINAL_STATUSES.has(media.status)) {
      return { outcome: "skipped", reason: "already_processed" };
    }
    if (media.originalKey !== params.key) {
      return { outcome: "skipped", reason: "key_mismatch" };
    }
    if (media.status === "pending_upload" && media.uploadExpiresAt && media.uploadExpiresAt.getTime() <= Date.now()) {
      media.markExpired("Upload expired before object processing completed");
      await this.mediaRepository.update(media);
      await this.storage.delete(params.key);
      return { outcome: "expired" };
    }

    const head = await this.storage.head(params.key);
    if (!head) {
      throw new Error("Media original object is missing");
    }
    if (!head.contentType) {
      return this.fail(media, "Uploaded object is missing content type metadata");
    }
    if (head.contentType !== media.mimeType) {
      return this.fail(media, "Uploaded object content type does not match declared mime type");
    }
    if (head.size !== media.filesize || (params.size !== undefined && params.size !== media.filesize)) {
      return this.fail(media, "Uploaded object size does not match declared filesize");
    }

    const original = await this.storage.get(params.key);
    if (!original) {
      throw new Error("Media original object disappeared before processing");
    }

    await this.ensureProcessing(media);

    try {
      const generated = await this.derivatives.generate(media, original.body);
      media.markReady(generated);
      await this.mediaRepository.update(media);
      return { outcome: "ready" };
    } catch (error) {
      if (isImageValidationError(error)) {
        media.markFailed(error.message);
        await this.mediaRepository.update(media);
        return { outcome: "failed" };
      }
      throw error;
    }
  }

  private async ensureProcessing(media: Media) {
    if (media.status === "processing") {
      return;
    }

    media.markProcessing();
    await this.mediaRepository.update(media);
  }

  private async fail(media: Media, reason: string) {
    media.markFailed(reason);
    await this.mediaRepository.update(media);
    return { outcome: "failed" as const };
  }
}
