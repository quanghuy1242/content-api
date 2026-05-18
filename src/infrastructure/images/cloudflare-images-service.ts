import {
  createImageValidationError,
  type ImageBinary,
  type ImageService,
  type ImageTransform,
} from "@/domain/media/image-service";

export class CloudflareImagesService implements ImageService {
  constructor(private readonly images: ImagesBinding) {}

  async inspect(stream: ReadableStream<Uint8Array>, contentType: string) {
    const info = await this.readInfo(stream, contentType);
    if (!("width" in info) || !("height" in info)) {
      throw createImageValidationError(`Unsupported image format for processing: ${contentType}`);
    }

    return {
      width: info.width,
      height: info.height,
    };
  }

  async render(stream: ReadableStream<Uint8Array>, transform: ImageTransform): Promise<ImageBinary> {
    const output = await this.renderOutput(stream, transform);

    return {
      body: output.image(),
      contentType: output.contentType(),
    };
  }

  private async readInfo(stream: ReadableStream<Uint8Array>, contentType: string) {
    try {
      return await this.images.info(stream);
    } catch (error) {
      if (isImagesValidationError(error)) {
        throw createImageValidationError(`Unsupported image format for processing: ${contentType}`);
      }
      throw error;
    }
  }

  async renderDataUrl(stream: ReadableStream<Uint8Array>, transform: ImageTransform) {
    const output = await this.renderOutput(stream, transform);
    const base64 = await new Response(output.image({ encoding: "base64" })).text();
    return `data:${output.contentType()};base64,${base64}`;
  }

  private renderOutput(stream: ReadableStream<Uint8Array>, transform: ImageTransform) {
    return this.images
      .input(stream)
      .transform({
        width: transform.width,
        height: transform.height,
        fit: transform.fit,
        blur: transform.blur,
      })
      .output({
        format: `image/${transform.format}`,
        quality: transform.quality,
      });
  }
}

function isImagesValidationError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === 9412;
}
