import { readFile } from 'node:fs/promises'
import { File } from 'node:buffer'
import type { TranscriptSegment } from '../shared/types'
import { fetchWithTimeout } from '../lib/fetchWithTimeout'
import { ProviderHttpError } from '../lib/providerError'
import type { SttProvider } from './types'

export interface XaiSttSettings {
  apiKey: string
  baseUrl: string
  model: string
}

interface XaiWord {
  text?: string
  start?: number
  end?: number
}

const PAUSE_GAP_S = 0.7

/**
 * xAI REST Speech-to-Text.
 * POST /v1/stt — file must be the last multipart field.
 * Word timings are grouped into pause-bounded segments without inventing times.
 */
export function createXaiStt(settings: XaiSttSettings): SttProvider {
  return {
    async transcribe(filePath, mimeType) {
      const audio = await readFile(filePath)
      const ext = mimeType.includes('wav') ? 'wav' : mimeType.includes('mp4') ? 'mp4' : 'webm'
      const form = new FormData()
      form.append('file', new File([audio], `audio.${ext}`, { type: mimeType }))

      const base = settings.baseUrl.replace(/\/$/, '')
      const res = await fetchWithTimeout(
        `${base}/stt`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${settings.apiKey}` },
          body: form
        },
        60_000
      )

      if (!res.ok) {
        console.error('[xai-stt]', JSON.stringify({ httpStatus: res.status, model: settings.model }))
        throw new ProviderHttpError('xai', res.status)
      }

      const json = (await res.json()) as {
        text?: string
        language?: string
        duration?: number
        words?: XaiWord[]
      }

      const durationMs = Math.round((json.duration ?? 0) * 1000)
      const words = (json.words ?? []).filter((w) => (w.text ?? '').trim().length > 0)
      const segments = wordsToSegments(words, durationMs)
      const text = (json.text ?? '').trim()
      if (text && segments.length === 0) {
        segments.push({ startMs: 0, endMs: durationMs, text })
      }

      return {
        text,
        segments,
        durationMs,
        language: json.language,
        wordCount: words.length
      }
    }
  }
}

/** Group consecutive words until a pause. Timestamps come only from xAI word start/end. */
export function wordsToSegments(words: XaiWord[], durationMs: number): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  let bucket: XaiWord[] = []

  const flush = (): void => {
    if (bucket.length === 0) return
    const start = bucket[0].start ?? 0
    const end = bucket[bucket.length - 1].end ?? start
    const text = bucket
      .map((w) => (w.text ?? '').trim())
      .filter(Boolean)
      .join(' ')
    if (text) {
      segments.push({
        startMs: Math.max(0, Math.round(start * 1000)),
        endMs: Math.max(0, Math.round(end * 1000)),
        text
      })
    }
    bucket = []
  }

  for (const word of words) {
    const prev = bucket[bucket.length - 1]
    if (prev && typeof word.start === 'number' && typeof prev.end === 'number') {
      const gap = word.start - prev.end
      const prevEndsSentence = /[.!?]$/.test((prev.text ?? '').trim())
      if (gap > PAUSE_GAP_S || prevEndsSentence) flush()
    }
    bucket.push(word)
  }
  flush()

  return segments.map((s) => ({
    ...s,
    endMs: durationMs > 0 ? Math.min(s.endMs, durationMs) : s.endMs
  }))
}
