import { Media, type MediaProps } from "@/domain/media/media.entity";
import { media } from "@/infrastructure/db/schema";

type MediaRow = typeof media.$inferSelect;

/**
 * Reconstitutes media metadata rows into the domain entity without adding upload
 * or processing concerns.
 */
export function mediaRowToEntity(row: MediaRow): Media {
  return Media.reconstitute({
    id: row.id,
    alt: row.alt,
    lowResUrl: row.lowResUrl,
    optimizedUrl: row.optimizedUrl,
    owner: row.owner,
    url: row.url,
    thumbnailURL: row.thumbnailURL,
    filename: row.filename,
    mimeType: row.mimeType,
    filesize: row.filesize,
    width: row.width,
    height: row.height,
    focalX: row.focalX,
    focalY: row.focalY,
    originalKey: row.originalKey,
    variantKeys: (row.variantKeysJson ?? {}) as Record<string, string>,
    uploadExpiresAt: row.uploadExpiresAt,
    status: row.status as MediaProps["status"],
    visibility: row.visibility as MediaProps["visibility"],
    version: row.version,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/**
 * Converts the media entity snapshot to a full insert row.
 */
export function mediaToInsertRow(input: Media) {
  return mediaSnapshotToPersistence(input.toSnapshot());
}

/**
 * Converts the mutable media entity state to a PATCH/update row.
 */
export function mediaToUpdateRow(input: Media) {
  const snapshot = input.toSnapshot();
  return {
    alt: snapshot.alt,
    lowResUrl: snapshot.lowResUrl,
    optimizedUrl: snapshot.optimizedUrl,
    url: snapshot.url,
    thumbnailURL: snapshot.thumbnailURL,
    filename: snapshot.filename,
    mimeType: snapshot.mimeType,
    filesize: snapshot.filesize,
    width: snapshot.width,
    height: snapshot.height,
    focalX: snapshot.focalX,
    focalY: snapshot.focalY,
    originalKey: snapshot.originalKey,
    variantKeysJson: snapshot.variantKeys,
    uploadExpiresAt: snapshot.uploadExpiresAt,
    status: snapshot.status,
    visibility: snapshot.visibility,
    version: snapshot.version,
    failureReason: snapshot.failureReason,
    updatedAt: snapshot.updatedAt,
  };
}

function mediaSnapshotToPersistence(snapshot: MediaProps) {
  return {
    id: snapshot.id,
    alt: snapshot.alt,
    lowResUrl: snapshot.lowResUrl,
    optimizedUrl: snapshot.optimizedUrl,
    owner: snapshot.owner,
    url: snapshot.url,
    thumbnailURL: snapshot.thumbnailURL,
    filename: snapshot.filename,
    mimeType: snapshot.mimeType,
    filesize: snapshot.filesize,
    width: snapshot.width,
    height: snapshot.height,
    focalX: snapshot.focalX,
    focalY: snapshot.focalY,
    originalKey: snapshot.originalKey,
    variantKeysJson: snapshot.variantKeys,
    uploadExpiresAt: snapshot.uploadExpiresAt,
    status: snapshot.status,
    visibility: snapshot.visibility,
    version: snapshot.version,
    failureReason: snapshot.failureReason,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}
