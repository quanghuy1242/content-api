export function isSqliteUniqueConstraintError(error: unknown, token?: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("UNIQUE constraint failed") && (token ? error.message.includes(token) : true);
}

export function isSqliteTriggerAbortError(error: unknown, token: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof Error && current.message.includes(token)) {
      return true;
    }
    if (typeof current === "object" && "cause" in current) {
      current = current.cause;
      continue;
    }
    break;
  }
  return false;
}
