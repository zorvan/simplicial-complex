/** Merge persisted plugin data onto current defaults. Missing v3 fields migrate safely. */
export function migrateSettings<T extends object>(defaults: T, saved: Partial<T> | null | undefined): T {
  return { ...defaults, ...(saved ?? {}) };
}
