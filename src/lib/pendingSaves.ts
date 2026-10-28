// Debounced editors register a flush here so other code can force pending writes before reading a sheet.

const flushers = new Set<() => Promise<void>>()

export function registerFlush(flush: () => Promise<void>) {
  flushers.add(flush)
  return () => flushers.delete(flush)
}

/** Writes every pending (debounced) save now, e.g. before reading a sheet to convert it. */
export async function flushPendingSaves() {
  await Promise.all([...flushers].map((f) => f()))
}
