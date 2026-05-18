import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorageSigner } from "@/domain/media/object-storage";

type PresignConfig = {
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export class R2PresignedUrlSigner implements ObjectStorageSigner {
  private readonly client: S3Client;

  constructor(private readonly config: PresignConfig) {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async createPresignedPutUrl(input: Parameters<ObjectStorageSigner["createPresignedPutUrl"]>[0]) {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: input.key,
        ContentType: input.contentType,
      }),
      { expiresIn: input.expiresInSeconds },
    );
  }
}
