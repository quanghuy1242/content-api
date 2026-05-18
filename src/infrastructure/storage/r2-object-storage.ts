import type { ObjectStorage } from "@/domain/media/object-storage";

export class R2ObjectStorage implements ObjectStorage {
  constructor(private readonly bucket: R2Bucket) {}

  async head(key: string) {
    const object = await this.bucket.head(key);
    if (!object) {
      return null;
    }

    return {
      size: object.size,
      contentType: object.httpMetadata?.contentType ?? null,
      etag: object.httpEtag ?? null,
    };
  }

  async get(key: string) {
    const object = await this.bucket.get(key);
    if (!object?.body) {
      return null;
    }

    return {
      body: object.body,
      size: object.size,
      contentType: object.httpMetadata?.contentType ?? null,
      etag: object.httpEtag ?? null,
    };
  }

  async put(input: Parameters<ObjectStorage["put"]>[0]) {
    const result = await this.bucket.put(input.key, input.body, {
      httpMetadata: {
        contentType: input.contentType,
      },
    });

    return { etag: result.httpEtag ?? null };
  }

  async delete(key: string) {
    await this.bucket.delete(key);
  }
}
