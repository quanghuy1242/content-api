import { mediaOriginalKey, type MediaVariantName } from "@/shared/constants";
import { ConflictError } from "@/shared/errors";

export type MediaStatus = "pending_upload" | "processing" | "ready" | "failed" | "expired";
export type MediaVisibility = "private" | "public";

export type MediaProps = {
  id: string;
  alt: string;
  lowResUrl: string | null;
  optimizedUrl: string | null;
  owner: string;
  url: string | null;
  thumbnailURL: string | null;
  filename: string;
  mimeType: string;
  filesize: number;
  width: number | null;
  height: number | null;
  focalX: number | null;
  focalY: number | null;
  originalKey: string | null;
  variantKeys: Record<string, string>;
  uploadExpiresAt: Date | null;
  status: MediaStatus;
  visibility: MediaVisibility;
  version: number;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateMediaProps = Omit<
  MediaProps,
  | "id"
  | "lowResUrl"
  | "optimizedUrl"
  | "url"
  | "thumbnailURL"
  | "width"
  | "height"
  | "originalKey"
  | "variantKeys"
  | "status"
  | "visibility"
  | "version"
  | "failureReason"
  | "createdAt"
  | "updatedAt"
>;

export type UpdateMediaProps = Partial<Pick<MediaProps, "alt" | "filename" | "focalX" | "focalY">>;

/**
 * Domain model for upload-backed media. It owns upload lifecycle transitions,
 * readiness guards, and the persistence snapshot used by repositories.
 */
export class Media {
  private constructor(private props: MediaProps) {}

  /**
   * Starts a private upload-backed media object with a generated key and
   * expiration deadline.
   */
  static create(input: CreateMediaProps) {
    const now = new Date();
    const id = crypto.randomUUID();
    const version = 1;
    return new Media({
      ...input,
      id,
      lowResUrl: null,
      optimizedUrl: null,
      url: null,
      thumbnailURL: null,
      width: null,
      height: null,
      originalKey: mediaOriginalKey(id, version),
      variantKeys: {},
      status: "pending_upload",
      visibility: "private",
      version,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: MediaProps) {
    return new Media({
      ...props,
      variantKeys: { ...props.variantKeys },
    });
  }

  get id() { return this.props.id; }
  get alt() { return this.props.alt; }
  get lowResUrl() { return this.props.lowResUrl; }
  get optimizedUrl() { return this.props.optimizedUrl; }
  get owner() { return this.props.owner; }
  get url() { return this.props.url; }
  get thumbnailURL() { return this.props.thumbnailURL; }
  get filename() { return this.props.filename; }
  get mimeType() { return this.props.mimeType; }
  get filesize() { return this.props.filesize; }
  get width() { return this.props.width; }
  get height() { return this.props.height; }
  get focalX() { return this.props.focalX; }
  get focalY() { return this.props.focalY; }
  get originalKey() { return this.props.originalKey; }
  get variantKeys() { return { ...this.props.variantKeys }; }
  get uploadExpiresAt() { return this.props.uploadExpiresAt; }
  get status() { return this.props.status; }
  get visibility() { return this.props.visibility; }
  get version() { return this.props.version; }
  get failureReason() { return this.props.failureReason; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }

  update(input: UpdateMediaProps) {
    if (input.alt !== undefined) this.props.alt = input.alt;
    if (input.filename !== undefined) this.props.filename = input.filename;
    if (input.focalX !== undefined) this.props.focalX = input.focalX;
    if (input.focalY !== undefined) this.props.focalY = input.focalY;
    this.touch();
  }

  publish() {
    this.requireStatus("ready", "Only ready media can be published");
    this.props.visibility = "public";
    this.touch();
  }

  unpublish() {
    this.props.visibility = "private";
    this.touch();
  }

  markProcessing() {
    this.requireStatus("pending_upload", "Only pending uploads can start processing");
    this.props.failureReason = null;
    this.props.status = "processing";
    this.touch();
  }

  markReady(input: {
    width: number;
    height: number;
    lowResUrl: string;
    variantKeys: Record<MediaVariantName, string>;
  }) {
    this.requireStatus("processing", "Only processing media can become ready");
    this.props.width = input.width;
    this.props.height = input.height;
    this.props.lowResUrl = input.lowResUrl;
    this.props.variantKeys = { ...input.variantKeys };
    this.props.url = input.variantKeys.medium ?? input.variantKeys.large ?? null;
    this.props.thumbnailURL = input.variantKeys.thumb ?? null;
    this.props.optimizedUrl = input.variantKeys.large ?? input.variantKeys.medium ?? null;
    this.props.status = "ready";
    this.props.uploadExpiresAt = null;
    this.props.failureReason = null;
    this.touch();
  }

  markFailed(reason: string) {
    if (this.props.status !== "pending_upload" && this.props.status !== "processing") {
      throw new ConflictError("Only pending or processing media can fail", {
        expectedStatuses: ["pending_upload", "processing"],
        actualStatus: this.props.status,
      });
    }
    this.props.status = "failed";
    this.props.failureReason = reason;
    this.touch();
  }

  markExpired(reason: string) {
    this.requireStatus("pending_upload", "Only pending uploads can expire");
    this.props.status = "expired";
    this.props.failureReason = reason;
    this.touch();
  }

  toSnapshot(): MediaProps {
    return {
      ...this.props,
      variantKeys: { ...this.props.variantKeys },
    };
  }

  private touch() {
    this.props.updatedAt = new Date();
  }

  private requireStatus(expected: MediaStatus, message: string) {
    if (this.props.status !== expected) {
      throw new ConflictError(message, {
        expectedStatus: expected,
        actualStatus: this.props.status,
      });
    }
  }
}
