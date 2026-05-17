import type { IdempotencyRecord } from "@/domain/idempotency/idempotency.repository";
import { idempotencyKeys } from "@/infrastructure/db/schema";

type IdempotencyRow = typeof idempotencyKeys.$inferSelect;

/**
 * Rehydrates an idempotency row into the domain record used by application
 * replay checks.
 */
export function idempotencyRowToRecord(row: IdempotencyRow): IdempotencyRecord {
  return {
    ...row,
    route: row.route as IdempotencyRecord["route"],
  };
}

/**
 * Converts an idempotency record-like payload to the persisted row shape for
 * batch insert workflows.
 */
export function idempotencyToInsertRow(input: Omit<IdempotencyRecord, "responseJson"> & { responseJson: string }) {
  return { ...input };
}
