/**
 * Produces deterministic JSON for request payload hashing by sorting object
 * keys recursively while preserving array order.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value));
}

export async function sha256Hex(value: unknown): Promise<string> {
  const payload = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeJsonValue(nested)]),
    );
  }

  return value;
}
