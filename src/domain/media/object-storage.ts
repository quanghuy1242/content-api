export type StoredObjectMetadata = {
  size: number;
  contentType: string | null;
  etag: string | null;
};

export type StoredObject = StoredObjectMetadata & {
  body: ReadableStream<Uint8Array>;
};

export interface ObjectStorage {
  head(key: string): Promise<StoredObjectMetadata | null>;
  get(key: string): Promise<StoredObject | null>;
  put(input: {
    key: string;
    body: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string;
    contentType: string;
  }): Promise<{ etag: string | null }>;
  delete(key: string): Promise<void>;
}

export interface ObjectStorageSigner {
  createPresignedPutUrl(input: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string>;
}
