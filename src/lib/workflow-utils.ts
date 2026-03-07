export function getSnapshotStatus(snapshot: unknown): string | undefined {
  if (typeof snapshot === 'string') {
    try {
      return JSON.parse(snapshot).status
    } catch {
      return undefined
    }
  }
  if (snapshot && typeof snapshot === 'object' && 'status' in snapshot) {
    return (snapshot as { status: string }).status
  }
  return undefined
}

export function parseSnapshot(snapshot: unknown): { status?: string; error?: string | Error } {
  if (typeof snapshot === 'string') {
    try {
      return JSON.parse(snapshot)
    } catch {
      return {}
    }
  }
  if (snapshot && typeof snapshot === 'object') {
    return snapshot as { status?: string; error?: string | Error }
  }
  return {}
}
