import { Book } from "@/domain/books/book.entity";
import { books } from "@/infrastructure/db/schema";

type BookRow = typeof books.$inferSelect;

export function bookRowToEntity(row: BookRow): Book {
  return Book.reconstitute({
    id: row.id,
    orgId: row.orgId,
    title: row.title,
    createdByUserId: row.createdByUserId,
    visibility: row.visibility as "private" | "public",
    status: row.status as "draft" | "scheduled" | "published" | "archived",
    publishedAt: row.publishedAt ?? null,
    scheduledAt: row.scheduledAt ?? null,
    archivedAt: row.archivedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function bookToInsertRow(book: Book) {
  const snap = book.toSnapshot();
  return {
    id: snap.id,
    orgId: snap.orgId,
    title: snap.title,
    createdByUserId: snap.createdByUserId,
    visibility: snap.visibility,
    status: snap.status,
    publishedAt: snap.publishedAt,
    scheduledAt: snap.scheduledAt,
    archivedAt: snap.archivedAt,
    createdAt: snap.createdAt,
    updatedAt: snap.updatedAt,
  };
}

export function bookToUpdateRow(book: Book) {
  const snap = book.toSnapshot();
  return {
    title: snap.title,
    visibility: snap.visibility,
    status: snap.status,
    publishedAt: snap.publishedAt,
    scheduledAt: snap.scheduledAt,
    archivedAt: snap.archivedAt,
    updatedAt: snap.updatedAt,
  };
}
