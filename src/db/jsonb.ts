export function parseJsonbArray<T = unknown>(raw: unknown): T[] {
  const value = parseJsonb(raw)
  return Array.isArray(value) ? value as T[] : []
}

export function parseJsonbObject<T extends Record<string, unknown> = Record<string, unknown>>(raw: unknown): T | null {
  const value = parseJsonb(raw)
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as T
    : null
}

export function parseJsonb<T = unknown>(raw: unknown): T | unknown {
  if (typeof raw !== "string") return raw
  try {
    return JSON.parse(raw) as T
  } catch {
    return raw
  }
}
