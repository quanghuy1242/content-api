export function isSqliteUniqueConstraintError(error: unknown, token?: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("UNIQUE constraint failed") && (token ? error.message.includes(token) : true);
}
