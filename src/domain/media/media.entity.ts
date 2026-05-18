export type MediaStatus = "ready";
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
  mimeType: string | null;
  filesize: number | null;
  width: number | null;
  height: number | null;
  focalX: number | null;
  focalY: number | null;
  status: MediaStatus;
  visibility: MediaVisibility;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateMediaProps = Omit<
  MediaProps,
  "id" | "lowResUrl" | "optimizedUrl" | "status" | "visibility" | "createdAt" | "updatedAt"
>;

export type UpdateMediaProps = Partial<
  Pick<MediaProps, "alt" | "url" | "thumbnailURL" | "filename" | "mimeType" | "filesize" | "width" | "height" | "focalX" | "focalY">
>;

/**
 * Domain model for media metadata only.
 *
 * Upload, image processing, and background derivative generation are explicitly
 * outside this API. The entity only tracks documented metadata and visibility
 * state used by read/publish policies.
 */
export class Media {
  private constructor(private props: MediaProps) {}

  /**
   * Creates private ready metadata. No binary upload state is modeled here.
   */
  static create(input: CreateMediaProps) {
    const now = new Date();
    return new Media({
      ...input,
      id: crypto.randomUUID(),
      lowResUrl: null,
      optimizedUrl: null,
      status: "ready",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: MediaProps) {
    return new Media({ ...props });
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
  get status() { return this.props.status; }
  get visibility() { return this.props.visibility; }
  get createdAt() { return this.props.createdAt; }
  get updatedAt() { return this.props.updatedAt; }

  update(input: UpdateMediaProps) {
    if (input.alt !== undefined) this.props.alt = input.alt;
    if (input.url !== undefined) this.props.url = input.url;
    if (input.thumbnailURL !== undefined) this.props.thumbnailURL = input.thumbnailURL;
    if (input.filename !== undefined) this.props.filename = input.filename;
    if (input.mimeType !== undefined) this.props.mimeType = input.mimeType;
    if (input.filesize !== undefined) this.props.filesize = input.filesize;
    if (input.width !== undefined) this.props.width = input.width;
    if (input.height !== undefined) this.props.height = input.height;
    if (input.focalX !== undefined) this.props.focalX = input.focalX;
    if (input.focalY !== undefined) this.props.focalY = input.focalY;
    this.touch();
  }

  publish() {
    this.props.visibility = "public";
    this.touch();
  }

  unpublish() {
    this.props.visibility = "private";
    this.touch();
  }

  toSnapshot(): MediaProps {
    return { ...this.props };
  }

  private touch() {
    this.props.updatedAt = new Date();
  }
}
