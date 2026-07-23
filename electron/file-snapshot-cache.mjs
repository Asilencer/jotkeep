export const createFileSnapshotCache = () => {
  const scopes = new Map()

  const scopeEntries = (scope) => {
    const current = scopes.get(scope)
    if (current) return current
    const entries = new Map()
    scopes.set(scope, entries)
    return entries
  }

  return {
    async read(scope, filePath, fingerprint, load) {
      const entries = scopeEntries(scope)
      const cached = entries.get(filePath)
      if (cached?.fingerprint === fingerprint) return cached.value
      const value = await load()
      entries.set(filePath, { fingerprint, value })
      return value
    },

    prune(scope, retainedPaths) {
      const entries = scopes.get(scope)
      if (!entries) return
      for (const filePath of entries.keys()) {
        if (!retainedPaths.has(filePath)) entries.delete(filePath)
      }
      if (entries.size === 0) scopes.delete(scope)
    },

    clear(scope) {
      scopes.delete(scope)
    },
  }
}
