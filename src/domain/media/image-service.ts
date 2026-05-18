export type ImageInfo = {
  width: number;
  height: number;
};

export type ImageTransform = {
  width: number;
  height?: number;
  fit: "cover" | "contain";
  blur?: number;
  format: "webp" | "jpeg";
  quality: number;
};

export type ImageBinary = {
  body: ReadableStream<Uint8Array>;
  contentType: string;
};

export function createImageValidationError(message: string) {
  const error = new Error(message);
  error.name = "ImageValidationError";
  return error;
}

export function isImageValidationError(error: unknown): error is Error {
  return error instanceof Error && error.name === "ImageValidationError";
}

export interface ImageService {
  inspect(stream: ReadableStream<Uint8Array>, contentType: string): Promise<ImageInfo>;
  render(stream: ReadableStream<Uint8Array>, transform: ImageTransform): Promise<ImageBinary>;
  renderDataUrl(stream: ReadableStream<Uint8Array>, transform: ImageTransform): Promise<string>;
}
