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
    status: row.status as "draft" | "published" | "archived",
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
    updatedAt: snap.updatedAt,
  };
}
