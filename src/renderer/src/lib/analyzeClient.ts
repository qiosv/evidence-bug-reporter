import type { AnalyzeSuccess, WorkflowPhase } from '../../../shared/types'
import { hasSessionCredentials, sessionAuthHeaders } from './sessionCredentials'

export class AnalyzeClientError extends Error {}

export function assertByokReady(mode: 'byok' | 'server' | null): void {
  if (mode === 'byok' && !hasSessionCredentials()) {
    throw new AnalyzeClientError(
      'xAI and Gemini API keys are required. Configure them in API Configuration.'
    )
  }
}

export async function postAnalyze(
  file: File,
  onProgress?: (phase: WorkflowPhase, message: string) => void
): Promise<AnalyzeSuccess> {
  const body = new FormData()
  body.append('video', file)
  const res = await fetch('/api/analyze', {
    method: 'POST',
    body,
    headers: sessionAuthHeaders()
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AnalyzeClientError(extractErrorMessage(text, res.status))
  }
  if (!res.body) throw new AnalyzeClientError('Analysis request failed.')
  return readSseAnalyze(res.body, onProgress)
}

function extractErrorMessage(text: string, status: number): string {
  try {
    const json = JSON.parse(text) as { error?: string; ok?: boolean }
    if (json.error) return json.error
  } catch {
    // not JSON
  }
  const sse = text.split('\n').find((l) => l.startsWith('data:'))
  if (sse) {
    try {
      const json = JSON.parse(sse.slice(5).trim()) as { error?: string }
      if (json.error) return json.error
    } catch {
      // ignore
    }
  }
  return text.trim() || `Analysis request failed (${status}).`
}

async function readSseAnalyze(
  body: ReadableStream<Uint8Array>,
  onProgress?: (phase: WorkflowPhase, message: string) => void
): Promise<AnalyzeSuccess> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: AnalyzeSuccess | null = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      const payload = JSON.parse(line.slice(5).trim()) as
        | { type: 'progress'; phase: WorkflowPhase; message: string }
        | { type: 'result'; data: AnalyzeSuccess }
        | { type: 'error'; error: string; provider?: string }
      if (payload.type === 'progress') {
        onProgress?.(payload.phase, payload.message)
      } else if (payload.type === 'result') {
        result = payload.data
      } else if (payload.type === 'error') {
        throw new AnalyzeClientError(
          payload.provider === 'groq' || payload.provider === 'gemini' || payload.provider === 'xai'
            ? `${payload.provider}: ${payload.error}`
            : payload.error
        )
      }
    }
  }
  if (!result) throw new AnalyzeClientError('Analysis ended without a report.')
  return result
}
