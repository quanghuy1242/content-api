/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { createExecutionContext, createMessageBatch, env, getQueueResult } from "cloudflare:test";
import { Media } from "@/domain/media/media.entity";
import type { MediaRepository } from "@/domain/media/media.repository";
import { createImageValidationError, type ImageService, type ImageInfo, type ImageTransform, type ImageBinary } from "@/domain/media/image-service";
import type { ObjectStorage, StoredObject, StoredObjectMetadata } from "@/domain/media/object-storage";
import { GenerateMediaDerivativesUseCase } from "@/application/media/generate-media-derivatives.usecase";
import { ProcessMediaUploadUseCase } from "@/application/media/process-media-upload.usecase";
import { createMediaProcessorQueueHandler } from "../workers/media-processor/src/index";

class InMemoryMediaRepository implements MediaRepository {
  constructor(private readonly rows: Map<string, Media>) {}

  async findById(_id: string): Promise<Media | null> {
    throw new Error("not implemented");
  }

  async findByOriginalKey(key: string) {
    return Array.from(this.rows.values()).find((media) => media.originalKey === key) ?? null;
  }

  async findMany(): Promise<never> {
    throw new Error("not implemented");
  }

  async create(input: Media) {
    this.rows.set(input.id, input);
    return input;
  }

  async update(media: Media) {
    this.rows.set(media.id, media);
    return media;
  }

  async delete(_id: string): Promise<boolean> {
    throw new Error("not implemented");
  }
}

class InMemoryObjectStorage implements ObjectStorage {
  constructor(
    private readonly metadata = new Map<string, StoredObjectMetadata>(),
    private readonly bodies = new Map<string, string>(),
  ) {}

  async head(key: string) {
    return this.metadata.get(key) ?? null;
  }

  async get(key: string): Promise<StoredObject | null> {
    const metadata = this.metadata.get(key);
    const body = this.bodies.get(key);
    if (!metadata || body === undefined) {
      return null;
    }

    return {
      ...metadata,
      body: streamFromString(body),
    };
  }

  async put(input: Parameters<ObjectStorage["put"]>[0]) {
    const body = await readStreamLike(input.body);
    this.metadata.set(input.key, {
      size: body.length,
      contentType: input.contentType,
      etag: `${input.key}-etag`,
    });
    this.bodies.set(input.key, body);
    return { etag: `${input.key}-etag` };
  }

  async delete(key: string) {
    this.metadata.delete(key);
    this.bodies.delete(key);
  }
}

class FakeImageService implements ImageService {
  async inspect(): Promise<ImageInfo> {
    return { width: 1280, height: 720 };
  }

  async renderDataUrl(): Promise<string> {
    return "data:image/webp;base64,ZmFrZQ==";
  }

  async render(_stream: ReadableStream<Uint8Array>, transform: ImageTransform): Promise<ImageBinary> {
    return {
      body: streamFromString(transform.format === "jpeg" ? "variant-og" : "variant-webp"),
      contentType: `image/${transform.format}`,
    };
  }
}

class InvalidImageService extends FakeImageService {
  override async inspect(): Promise<never> {
    throw createImageValidationError("Unsupported image format for processing: image/jpeg");
  }
}

class TransientImageService extends FakeImageService {
  private attempts = 0;

  override async inspect(): Promise<ImageInfo> {
    this.attempts += 1;
    if (this.attempts === 1) {
      throw new Error("temporary images outage");
    }
    return super.inspect();
  }
}

describe("media-upload", () => {
it("starts upload-backed media in pending state and blocks publish before ready", () => {
  const media = buildPendingMedia({
    id: "media-1",
    mimeType: "image/png",
    filesize: 2048,
  });

  expect(media.status).toBe("pending_upload");
  expect(media.originalKey).toContain(`/v1/original`);
});

it("marks a valid uploaded object ready and writes every generated variant", async () => {
  const media = buildPendingMedia({
    id: "media-2",
    mimeType: "image/jpeg",
    filesize: 12,
  });
  const repository = new InMemoryMediaRepository(new Map([[media.id, media]]));
  const storage = new InMemoryObjectStorage(
    new Map([[media.originalKey!, { size: 12, contentType: "image/jpeg", etag: "original-etag" }]]),
    new Map([[media.originalKey!, "hello-world!!"]]),
  );
  const derivatives = new GenerateMediaDerivativesUseCase(new FakeImageService(), storage);
  const useCase = new ProcessMediaUploadUseCase(repository, storage, derivatives);

  const result = await useCase.execute({ key: media.originalKey!, size: 12 });

  expect(result.outcome).toBe("ready");
  const updated = await repository.findByOriginalKey(media.originalKey!);
  expect(updated?.status).toBe("ready");
  expect(updated?.width).toBe(1280);
  expect(updated?.variantKeys.medium).toContain("/variants/medium.webp");
  expect((await storage.get(updated!.variantKeys.medium))?.contentType).toBe("image/webp");
});

it("keeps transient processor failures retryable", async () => {
  const media = buildPendingMedia({
    id: "media-retry",
    mimeType: "image/jpeg",
    filesize: 12,
  });
  const repository = new InMemoryMediaRepository(new Map([[media.id, media]]));
  const storage = new InMemoryObjectStorage(
    new Map([[media.originalKey!, { size: 12, contentType: "image/jpeg", etag: "original-etag" }]]),
    new Map([[media.originalKey!, "hello-world!!"]]),
  );
  const derivatives = new GenerateMediaDerivativesUseCase(new TransientImageService(), storage);
  const useCase = new ProcessMediaUploadUseCase(repository, storage, derivatives);

  await expect(useCase.execute({ key: media.originalKey!, size: 12 })).rejects.toThrow("temporary images outage");
  expect((await repository.findByOriginalKey(media.originalKey!))?.status).toBe("processing");

  const result = await useCase.execute({ key: media.originalKey!, size: 12 });

  expect(result.outcome).toBe("ready");
  expect((await repository.findByOriginalKey(media.originalKey!))?.status).toBe("ready");
});

it("marks invalid image bytes failed without asking the queue to retry", async () => {
  const media = buildPendingMedia({
    id: "media-invalid",
    mimeType: "image/jpeg",
    filesize: 12,
  });
  const repository = new InMemoryMediaRepository(new Map([[media.id, media]]));
  const storage = new InMemoryObjectStorage(
    new Map([[media.originalKey!, { size: 12, contentType: "image/jpeg", etag: "original-etag" }]]),
    new Map([[media.originalKey!, "hello-world!!"]]),
  );
  const derivatives = new GenerateMediaDerivativesUseCase(new InvalidImageService(), storage);
  const useCase = new ProcessMediaUploadUseCase(repository, storage, derivatives);

  const result = await useCase.execute({ key: media.originalKey!, size: 12 });

  expect(result.outcome).toBe("failed");
  expect((await repository.findByOriginalKey(media.originalKey!))?.status).toBe("failed");
});

it("marks expired uploads when the object arrives after expiry", async () => {
  const media = buildPendingMedia({
    id: "media-3",
    mimeType: "image/jpeg",
    filesize: 12,
    uploadExpiresAt: new Date(Date.now() - 1_000),
  });
  const repository = new InMemoryMediaRepository(new Map([[media.id, media]]));
  const storage = new InMemoryObjectStorage(
    new Map([[media.originalKey!, { size: 12, contentType: "image/jpeg", etag: "original-etag" }]]),
    new Map([[media.originalKey!, "hello-world!!"]]),
  );
  const derivatives = new GenerateMediaDerivativesUseCase(new FakeImageService(), storage);
  const useCase = new ProcessMediaUploadUseCase(repository, storage, derivatives);

  const result = await useCase.execute({ key: media.originalKey!, size: 12 });

  expect(result.outcome).toBe("expired");
  expect((await repository.findByOriginalKey(media.originalKey!))?.status).toBe("expired");
  expect(await storage.get(media.originalKey!)).toBeNull();
});

it("acks invalid queue keys and retries failed processing", async () => {
  const processed: string[] = [];
  const queue = createMediaProcessorQueueHandler(async ({ key }) => {
    processed.push(key);
    if (key.includes("retry-me")) {
      throw new Error("boom");
    }
  });

  const batch = createMessageBatch<{
    action: "PutObject";
    object: { key: string };
  }>("media-processing", [
    { id: "1", timestamp: new Date(), attempts: 1, body: { action: "PutObject", object: { key: "not-media/file" } } },
    { id: "2", timestamp: new Date(), attempts: 1, body: { action: "PutObject", object: { key: "media/retry-me/v1/original" } } },
  ]);
  const ctx = createExecutionContext();

  await queue(batch, env, ctx);
  const result = await getQueueResult(batch, ctx);

  expect(processed).toEqual(["media/retry-me/v1/original"]);
  expect(result.ackAll).toBe(false);
  expect(result.retryMessages).toEqual([{ msgId: "2" }]);
});
});

function buildPendingMedia(input: {
  id: string;
  mimeType: string;
  filesize: number;
  uploadExpiresAt?: Date;
}): Media {
  const now = new Date();
  return Media.reconstitute({
    id: input.id,
    orgId: "org-main",
    alt: "test",
    lowResUrl: null,
    optimizedUrl: null,
    owner: "user-1",
    url: null,
    thumbnailURL: null,
    filename: "test.png",
    mimeType: input.mimeType,
    filesize: input.filesize,
    width: null,
    height: null,
    focalX: null,
    focalY: null,
    originalKey: `media/${input.id}/v1/original`,
    variantKeys: {},
    uploadExpiresAt: input.uploadExpiresAt ?? new Date(Date.now() + 60_000),
    status: "pending_upload",
    visibility: "private",
    version: 1,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
  });
}

function streamFromString(value: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

async function readStreamLike(input: Parameters<ObjectStorage["put"]>[0]["body"]) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new TextDecoder().decode(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new TextDecoder().decode(input);
  }

  const reader = input.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    chunks.push(result.value);
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
