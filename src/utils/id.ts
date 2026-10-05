let counter = 0;

/** Short unique id for in-memory entities. Not cryptographic; not persisted across sessions. */
export function createId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}
