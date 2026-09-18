import { readFile } from 'node:fs/promises'
import { File } from 'node:buffer'
import type { TranscriptSegment } from '../shared/types'
import { fetchWithTimeout } from '../lib/fetchWithTimeout'
import { ProviderHttpError } from '../lib/providerError'
import type { SttProvider } from './types'

export type { SttProvider } from './types'

export interface GroqSettings {
  apiKey: string
  baseUrl: string
  model: string
}

export async function pingGroqModels(settings: GroqSettings): Promise<number> {
  const base = settings.baseUrl.replace(/\/$/, '')
  const res = await fetchWithTimeout(
    `${base}/models`,
    { headers: { Authorization: `Bearer ${settings.apiKey}` } },
    15_000
  )
  return res.status
}

/**
 * OpenAI-compatible audio transcription client.
 * Adapted from upstream `src/main/stt.ts` (Interview Copilot / Iview Protect).
 * Changes: verbose_json timestamps, segment mapping, wav/mp4 upload, empty-audio tolerance.
 */
export function createGroqStt(settings: GroqSettings): SttProvider {
  return {
    async transcribe(filePath, mimeType) {
      const audio = await readFile(filePath)
      const ext = mimeType.includes('wav') ? 'wav' : mimeType.includes('mp4') ? 'mp4' : 'webm'
      const form = new FormData()
      form.append('file', new File([audio], `audio.${ext}`, { type: mimeType }))
      form.append('model', settings.model)
      form.append('response_format', 'verbose_json')
      form.append('timestamp_granularities[]', 'segment')

      const headers: Record<string, string> = {}
      if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`

      const base = settings.baseUrl.replace(/\/$/, '')
      const res = await fetchWithTimeout(
        `${base}/audio/transcriptions`,
        { method: 'POST', headers, body: form },
        60_000
      )

      if (!res.ok) {
        console.error('[groq]', JSON.stringify({ httpStatus: res.status, model: settings.model }))
        throw new ProviderHttpError('groq', res.status)
      }

      const json = (await res.json()) as {
        text?: string
        duration?: number
        segments?: Array<{ start?: number; end?: number; text?: string }>
      }

      const segments: TranscriptSegment[] = (json.segments ?? [])
        .map((s) => ({
          startMs: Math.round((s.start ?? 0) * 1000),
          endMs: Math.round((s.end ?? 0) * 1000),
          text: (s.text ?? '').trim()
        }))
        .filter((s) => s.text.length > 0)

      const text = (json.text ?? '').trim()
      if (text && segments.length === 0) {
        segments.push({ startMs: 0, endMs: Math.round((json.duration ?? 0) * 1000), text })
      }

      return {
        text,
        segments,
        durationMs: Math.round((json.duration ?? 0) * 1000)
      }
    }
  }
}
