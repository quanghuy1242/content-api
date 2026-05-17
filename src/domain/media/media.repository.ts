import type { Media } from "@/domain/media/media.entity";
import type { CursorPage } from "@/shared/pagination/cursor";

export interface MediaRepository {
  findMany(params: {
    limit: number;
    cursor?: string;
    includePrivateOwnedBy?: string | null;
    includePublicOnly: boolean;
  }): Promise<CursorPage<Media>>;
  findById(id: string): Promise<Media | null>;
  create(input: Media): Promise<Media>;
  update(media: Media): Promise<Media>;
  delete(id: string): Promise<boolean>;
}
