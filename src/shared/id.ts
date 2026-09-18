export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function formatTimestamp(ms: number): string {
  const clamped = Math.max(0, ms)
  const totalSeconds = clamped / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - minutes * 60
  const whole = Math.floor(seconds)
  const tenths = Math.round((seconds - whole) * 10)
  if (tenths === 10) {
    return `${minutes}:${String(whole + 1).padStart(2, '0')}.0`
  }
  return `${minutes}:${String(whole).padStart(2, '0')}.${tenths}`
}

export function coerceTimestampMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0 && value <= 180 && !Number.isInteger(value)) return Math.round(value * 1000)
    if (value >= 0 && value <= 180) return Math.round(value * 1000)
    return Math.max(0, Math.round(value))
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const clock = trimmed.match(/^(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/)
    if (clock) {
      const minutes = Number(clock[1])
      const seconds = Number(clock[2])
      const frac = clock[3] ? Number(clock[3].padEnd(3, '0').slice(0, 3)) : 0
      return minutes * 60_000 + seconds * 1000 + frac
    }
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) return coerceTimestampMs(numeric)
  }
  return 0
}
