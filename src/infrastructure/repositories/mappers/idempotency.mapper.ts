import type { IdempotencyRecord } from "@/domain/idempotency/idempotency.repository";
import { idempotencyKeys } from "@/infrastructure/db/schema";

type IdempotencyRow = typeof idempotencyKeys.$inferSelect;

/**
 * Rehydrates an idempotency row into the domain record used by application
 * replay checks.
 */
export function idempotencyRowToRecord(row: IdempotencyRow): IdempotencyRecord {
  return {
    key: row.key,
    actorId: row.actorId,
    route: row.route as IdempotencyRecord["route"],
    requestHash: row.requestHash,
    responseJson: row.responseJson,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * Converts an idempotency record-like payload to the persisted row shape for
 * batch insert workflows.
 */
export function idempotencyToInsertRow(input: Omit<IdempotencyRecord, "responseJson"> & { responseJson: string }) {
  return {
    key: input.key,
    actorId: input.actorId,
    route: input.route,
    requestHash: input.requestHash,
    responseJson: input.responseJson,
    status: input.status,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  };
}
