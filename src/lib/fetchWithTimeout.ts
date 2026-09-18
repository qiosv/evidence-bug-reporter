export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const parent = init.signal
  const onAbort = (): void => controller.abort()
  if (parent) {
    if (parent.aborted) controller.abort()
    else parent.addEventListener('abort', onAbort, { once: true })
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Network timeout after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener('abort', onAbort)
  }
}
