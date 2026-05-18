import type { Media } from "@/domain/media/media.entity";
import {
  MEDIA_DERIVATIVE_STREAM_OVERHEAD,
  MEDIA_LOW_RES_PLACEHOLDER,
  mediaVariantKey,
  MEDIA_VARIANT_NAMES,
  MEDIA_VARIANT_STREAM_OFFSET,
  MEDIA_VARIANTS,
} from "@/shared/constants";
import type { ImageService } from "@/domain/media/image-service";
import type { ObjectStorage } from "@/domain/media/object-storage";

type GeneratedMediaDerivatives = {
  width: number;
  height: number;
  lowResUrl: string;
  variantKeys: Record<(typeof MEDIA_VARIANT_NAMES)[number], string>;
};

export class GenerateMediaDerivativesUseCase {
  constructor(
    private readonly imageService: ImageService,
    private readonly storage: ObjectStorage,
  ) {}

  async generate(media: Media, originalBody: ReadableStream<Uint8Array>): Promise<GeneratedMediaDerivatives> {
    const streams = cloneReadableStream(originalBody, MEDIA_VARIANT_NAMES.length + MEDIA_DERIVATIVE_STREAM_OVERHEAD);
    const info = await this.imageService.inspect(streams[0], media.mimeType);
    const lowResUrl = await this.imageService.renderDataUrl(streams[1], {
      width: MEDIA_LOW_RES_PLACEHOLDER.width,
      height: MEDIA_LOW_RES_PLACEHOLDER.height,
      fit: "cover",
      blur: MEDIA_LOW_RES_PLACEHOLDER.blur,
      format: MEDIA_LOW_RES_PLACEHOLDER.format,
      quality: MEDIA_LOW_RES_PLACEHOLDER.quality,
    });

    const generatedVariantEntries = await Promise.all(
      MEDIA_VARIANT_NAMES.map(async (variantName, index) => {
        const variant = MEDIA_VARIANTS[variantName];
        const rendered = await this.imageService.render(
          streams[index + MEDIA_VARIANT_STREAM_OFFSET],
          {
            width: variant.width,
            height: "height" in variant ? variant.height : undefined,
            fit: variant.fit,
            blur: "blur" in variant ? variant.blur : undefined,
            format: variant.format,
            quality: variant.quality,
          },
        );
        const key = media.variantKeys[variantName] || mediaVariantKey(media.id, media.version, variantName);
        await this.storage.put({
          key,
          body: rendered.body,
          contentType: rendered.contentType,
        });
        return [variantName, key] as const;
      }),
    );

    return {
      width: info.width,
      height: info.height,
      lowResUrl,
      variantKeys: Object.fromEntries(generatedVariantEntries) as Record<(typeof MEDIA_VARIANT_NAMES)[number], string>,
    };
  }
}

function cloneReadableStream(stream: ReadableStream<Uint8Array>, count: number): ReadableStream<Uint8Array>[] {
  if (count < 1) {
    return [];
  }

  const result: ReadableStream<Uint8Array>[] = [];
  let current = stream;
  while (result.length < count - 1) {
    const [left, right] = current.tee();
    result.push(left);
    current = right;
  }
  result.push(current);
  return result;
}
