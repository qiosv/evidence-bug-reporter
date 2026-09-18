import { readFile } from 'node:fs/promises'
import { visualAnalysisSchema, geminiVisualResponseSchema } from '../shared/schemas'
import type { VisualAnalysis } from '../shared/types'
import { VIDEO_ANALYSIS_SYSTEM, buildVideoAnalysisPrompt } from '../prompts/videoAnalysis'
import { coerceTimestampMs } from '../shared/id'
import { fetchWithTimeout } from '../lib/fetchWithTimeout'
import { ProviderHttpError } from '../lib/providerError'
import { sanitizeSecrets } from '../lib/sanitizeSecrets'

export interface GeminiSettings {
  apiKey: string
  model: string
  baseUrl: string
}

export interface GeminiUsage {
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
}

export interface VideoAnalysisResult {
  visual: VisualAnalysis
  usage: GeminiUsage
  rawText: string
  delivery: 'inline' | 'files_api'
}

export class GeminiParseError extends Error {
  rawText: string
  usage: GeminiUsage
  constructor(message: string, rawText: string, usage: GeminiUsage) {
    super(message)
    this.name = 'GeminiParseError'
    this.rawText = rawText
    this.usage = usage
  }
}

const INLINE_LIMIT = 18 * 1024 * 1024

/**
 * Gemini REST client for multimodal video analysis.
 * Request shape adapted from upstream `src/main/llm.ts` (Interview Copilot Gemini path).
 * New: non-streaming JSON, video inline/Files API, responseSchema, Zod validation.
 */
export function createGeminiProvider(settings: GeminiSettings) {
  const base = (settings.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(
    /\/$/,
    ''
  )

  return {
    async analyzeVideo(args: {
      filePath: string
      mimeType: string
      transcriptText: string
      durationMs: number
      signal?: AbortSignal
    }): Promise<VideoAnalysisResult> {
      const bytes = await readFile(args.filePath)
      const prompt = buildVideoAnalysisPrompt(args.transcriptText, args.durationMs)
      const parts: unknown[] = []

      let delivery: 'inline' | 'files_api' = 'inline'
      if (bytes.length <= INLINE_LIMIT) {
        parts.push({
          inline_data: {
            mime_type: args.mimeType || 'video/mp4',
            data: bytes.toString('base64')
          }
        })
      } else {
        delivery = 'files_api'
        const uploaded = await uploadFile(base, settings.apiKey, bytes, args.mimeType || 'video/mp4')
        parts.push({
          file_data: {
            mime_type: uploaded.mimeType,
            file_uri: uploaded.uri
          }
        })
      }

      parts.push({ text: prompt })

      const body = {
        contents: [{ role: 'user', parts }],
        systemInstruction: { parts: [{ text: VIDEO_ANALYSIS_SYSTEM }] },
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: geminiVisualResponseSchema
        }
      }

      const { json, usage } = await generateContent(base, settings.apiKey, settings.model, body, args.signal)
      const rawText = extractText(json)
      try {
        const visual = parseVisual(rawText)
        return { visual, usage, rawText, delivery }
      } catch (err) {
        throw new GeminiParseError(err instanceof Error ? err.message : String(err), rawText, usage)
      }
    },

    async retryParse(args: {
      rawText: string
      errorMessage: string
      signal?: AbortSignal
    }): Promise<VideoAnalysisResult> {
      const body = {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `The previous JSON failed validation:\n${args.errorMessage}\n\nInvalid payload:\n${args.rawText.slice(0, 12000)}\n\nReturn corrected JSON only, same schema. Do not invent new visual facts.`
              }
            ]
          }
        ],
        systemInstruction: { parts: [{ text: VIDEO_ANALYSIS_SYSTEM }] },
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: geminiVisualResponseSchema
        }
      }
      const { json, usage } = await generateContent(base, settings.apiKey, settings.model, body, args.signal)
      const rawText = extractText(json)
      try {
        const visual = parseVisual(rawText)
        return { visual, usage, rawText, delivery: 'inline' }
      } catch (err) {
        throw new GeminiParseError(err instanceof Error ? err.message : String(err), rawText, usage)
      }
    }
  }
}

function parseVisual(rawText: string): VisualAnalysis {
  const parsed = JSON.parse(stripFences(rawText)) as unknown
  const visual = visualAnalysisSchema.parse(parsed)
  return {
    ...visual,
    startingConditions: visual.startingConditions.map((c) => ({
      ...c,
      timestampMs: coerceTimestampMs(c.timestampMs)
    })),
    startingState: visual.startingState ?? [],
    stateObservations: (visual.stateObservations ?? []).map((obs) => ({
      ...obs,
      timestampMs: coerceTimestampMs(obs.timestampMs),
      stateBefore: obs.stateBefore ?? [],
      stateAfter: obs.stateAfter ?? []
    })),
    visibleActions: visual.visibleActions.map((a) => ({
      ...a,
      timestampMs: coerceTimestampMs(a.timestampMs)
    })),
    visibleFailures: visual.visibleFailures.map((f) => ({
      ...f,
      timestampMs: coerceTimestampMs(f.timestampMs)
    })),
    speakerVisualContradictions: visual.speakerVisualContradictions.map((c) => ({
      ...c,
      timestampMs: coerceTimestampMs(c.timestampMs)
    }))
  }
}

function stripFences(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  return match ? match[1].trim() : trimmed
}

function extractText(json: Record<string, unknown>): string {
  const candidates = json.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined
  const text = candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!text.trim()) {
    const block = json.promptFeedback ?? json.error
    throw new Error(`Gemini returned no JSON text. ${sanitizeSecrets(JSON.stringify(block ?? json).slice(0, 400))}`)
  }
  return text
}

async function generateContent(
  base: string,
  apiKey: string,
  model: string,
  body: unknown,
  signal?: AbortSignal
): Promise<{ json: Record<string, unknown>; usage: GeminiUsage }> {
  const url = `${base}/models/${model}:generateContent`
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal,
      body: JSON.stringify(body)
    },
    180_000
  )
  if (!res.ok) {
    console.error('[gemini]', JSON.stringify({ httpStatus: res.status, model }))
    throw new ProviderHttpError('gemini', res.status)
  }
  const json = (await res.json()) as Record<string, unknown>
  const usageMeta = json.usageMetadata as
    | {
        promptTokenCount?: number
        candidatesTokenCount?: number
        cachedContentTokenCount?: number
      }
    | undefined
  return {
    json,
    usage: {
      inputTokens: usageMeta?.promptTokenCount ?? null,
      outputTokens: usageMeta?.candidatesTokenCount ?? null,
      cachedInputTokens: usageMeta?.cachedContentTokenCount ?? null
    }
  }
}

async function uploadFile(
  base: string,
  apiKey: string,
  bytes: Buffer,
  mimeType: string
): Promise<{ uri: string; mimeType: string }> {
  const start = await fetchWithTimeout(
    `${base.replace('/v1beta', '')}/upload/v1beta/files`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(bytes.length),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file: { displayName: 'recording.mp4' } })
    },
    30_000
  )
  if (!start.ok) {
    console.error('[gemini]', JSON.stringify({ httpStatus: start.status, phase: 'file-upload-start' }))
    throw new ProviderHttpError('gemini', start.status)
  }
  const uploadUrl = start.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new Error('Gemini file upload did not return an upload URL.')

  const put = await fetchWithTimeout(
    uploadUrl,
    {
      method: 'POST',
      headers: {
        'Content-Length': String(bytes.length),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize'
      },
      body: new Uint8Array(bytes)
    },
    120_000
  )
  if (!put.ok) {
    console.error('[gemini]', JSON.stringify({ httpStatus: put.status, phase: 'file-upload' }))
    throw new ProviderHttpError('gemini', put.status)
  }
  const fileJson = (await put.json()) as { file?: { uri?: string; name?: string; mimeType?: string; state?: string } }
  const file = fileJson.file
  if (!file?.uri && !file?.name) throw new Error('Gemini file upload returned no file uri.')

  const name = file.name ?? file.uri
  const deadline = Date.now() + 60_000
  let state = file.state ?? 'PROCESSING'
  let uri = file.uri
  let mime = file.mimeType ?? mimeType
  while (state === 'PROCESSING' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500))
    const poll = await fetchWithTimeout(
      `${base}/${name}`,
      { method: 'GET', headers: { 'x-goog-api-key': apiKey } },
      15_000
    )
    if (!poll.ok) break
    const polled = (await poll.json()) as { uri?: string; mimeType?: string; state?: string }
    state = polled.state ?? state
    uri = polled.uri ?? uri
    mime = polled.mimeType ?? mime
  }
  if (state && state !== 'ACTIVE') {
    throw new Error(`Gemini file processing did not become ACTIVE (state=${state}).`)
  }
  if (!uri) throw new Error('Gemini file is missing uri.')
  return { uri, mimeType: mime }
}
