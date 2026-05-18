import { z } from "@hono/zod-openapi";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "@/shared/constants";

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().optional(),
  sort: z.string().optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type CursorPage<T> = {
  data: T[];
  page: {
    nextCursor?: string;
  };
};

/**
 * Encode a stable cursor from the sorted timestamp and row id.
 */
export function encodeCursor(createdAt: number, id: string) {
  return btoa(`${createdAt}:${id}`);
}

/**
 * Decode cursors produced by `encodeCursor`; invalid cursors are ignored.
 */
export function decodeCursor(cursor?: string) {
  if (!cursor) {
    return null;
  }

  let decoded: string;
  try {
    decoded = atob(cursor);
  } catch {
    return null;
  }

  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return null;
  }

  const createdAt = Number(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (!Number.isFinite(createdAt) || !id) {
    return null;
  }

  return { createdAt, id };
}
