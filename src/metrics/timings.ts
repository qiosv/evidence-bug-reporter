export function nowMs(): number {
  return Date.now()
}

export function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}
