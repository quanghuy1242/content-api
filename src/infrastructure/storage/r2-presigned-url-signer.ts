import type { ObjectStorageSigner } from "@/domain/media/object-storage";

type PresignConfig = {
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
};

const encoder = new TextEncoder();

export class R2PresignedUrlSigner implements ObjectStorageSigner {
  constructor(private readonly config: PresignConfig) {}

  async createPresignedPutUrl(input: Parameters<ObjectStorageSigner["createPresignedPutUrl"]>[0]) {
    const { accessKeyId, secretAccessKey, accountId, bucketName } = this.config;
    const host = `${bucketName}.${accountId}.r2.cloudflarestorage.com`;
    const method = "PUT";
    const region = "auto";
    const service = "s3";

    const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

    const query = new URLSearchParams();
    query.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
    query.set("X-Amz-Credential", `${accessKeyId}/${credentialScope}`);
    query.set("X-Amz-Date", amzDate);
    query.set("X-Amz-Expires", String(input.expiresInSeconds));
    query.set("X-Amz-SignedHeaders", "content-type;host");
    query.sort();

    const canonicalRequest = [
      method,
      `/${input.key}`,
      query.toString(),
      `content-type:${input.contentType}\nhost:${host}\n`,
      "content-type;host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      await sha256Hex(canonicalRequest),
    ].join("\n");

    const signingKey = await getSigningKey(secretAccessKey, dateStamp, region, service);
    const signature = await hmacHex(signingKey, stringToSign);

    query.set("X-Amz-Signature", signature);
    return `https://${host}/${input.key}?${query.toString()}`;
  }
}

async function sha256Hex(data: string) {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

async function hmacHex(key: ArrayBuffer | Uint8Array, data: string) {
  const sig = await hmac(key, data);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getSigningKey(secretKey: string, dateStamp: string, region: string, service: string) {
  const kDate = await hmac(encoder.encode(`AWS4${secretKey}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}
