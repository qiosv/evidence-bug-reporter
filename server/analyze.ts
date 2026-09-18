import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { activeSttModel, createSttProvider, sttIsConfigured } from '../src/transcription/select'
import { createGeminiProvider, GeminiParseError } from '../src/ai/gemini'
import { extractAudioWav, extractMetadata, validateMetadata, VideoValidationError } from '../src/video/metadata'
import { mergeEvidence } from '../src/analysis/evidenceMerger'
import { validateReport } from '../src/analysis/reportGenerator'
import { estimateCost } from '../src/metrics/cost'
import { elapsedMs, nowMs } from '../src/metrics/timings'
import type { AnalyzeSuccess, VisualAnalysis, WorkflowPhase } from '../src/shared/types'
import { bugReportSchema } from '../src/shared/schemas'
import { ProviderHttpError } from '../src/lib/providerError'
import { publicAuthError, publicProviderError } from '../src/lib/sanitizeSecrets'

export class AnalyzeError extends Error {
  status: number
  provider?: 'groq' | 'gemini' | 'xai' | 'server'
  constructor(message: string, status = 400, provider?: 'groq' | 'gemini' | 'xai' | 'server') {
    super(message)
    this.status = status
    this.provider = provider
  }
}

export interface AnalyzeFile {
  path: string
  originalName: string
  mimeType: string
}

type ProgressFn = (phase: WorkflowPhase, message: string) => void

export async function analyzeRecording(
  file: AnalyzeFile,
  env: ReturnType<typeof import('./env').requireEnv>,
  onProgress: ProgressFn
): Promise<AnalyzeSuccess> {
  const started = nowMs()
  let validationMs = 0
  let transcriptionMs = 0
  let videoAnalysisMs = 0
  let reportGenerationMs = 0
  let retryCount = 0
  let aiCallCount = 0
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  let retryInput = 0
  let retryOutput = 0
  let cachedInputTokens: number | null = null
  let geminiDelivery: AnalyzeSuccess['metrics']['usage']['geminiDelivery'] = 'none'
  const tmpWav = join(tmpdir(), `replay-${randomUUID()}.wav`)
  const sttProvider = env.transcriptionProvider
  const sttModel = activeSttModel(env)

  try {
    onProgress('validating', 'Checking MP4 metadata…')
    const tValidate = nowMs()
    const meta = await extractMetadata(file.path, file.mimeType || 'video/mp4')
    validateMetadata(meta, file.originalName)
    validationMs = elapsedMs(tValidate)

    if (!sttIsConfigured(env)) {
      throw new AnalyzeError('Speech transcription provider is not configured.', 503, sttProvider)
    }
    if (!env.geminiApiKey) {
      throw new AnalyzeError('Video analysis provider is not configured.', 503, 'gemini')
    }

    onProgress('transcribing', 'Transcribing speech (optional narration)…')
    const tStt = nowMs()
    const stt = createSttProvider(env)

    let segments: AnalyzeSuccess['transcript'] = []
    let audioDurationMs = 0
    let transcriptText = ''

    if (meta.hasAudio) {
      const wavOk = await extractAudioWav(file.path, tmpWav)
      const sttPath = wavOk ? tmpWav : file.path
      const sttMime = wavOk ? 'audio/wav' : 'video/mp4'
      try {
        const result = await stt.transcribe(sttPath, sttMime)
        transcriptText = result.text
        segments = result.segments
        audioDurationMs = result.durationMs || meta.durationMs
        aiCallCount += 1
      } catch (err) {
        if (err instanceof ProviderHttpError) {
          console.error('[analyze:error]', JSON.stringify({
            provider: sttProvider,
            httpStatus: err.httpStatus,
            model: sttModel
          }))
          if (err.httpStatus === 401 || err.httpStatus === 403) {
            throw new AnalyzeError(publicAuthError(sttProvider), 401, sttProvider)
          }
          throw new AnalyzeError(publicProviderError(sttProvider), 502, sttProvider)
        }
        const message = err instanceof Error ? err.message : String(err)
        if (/no.*audio|empty|could not process|silent|timeout/i.test(message)) {
          if (/timeout/i.test(message)) {
            console.error('[analyze:error]', JSON.stringify({ provider: sttProvider, error: 'timeout', model: sttModel }))
            throw new AnalyzeError(publicProviderError(sttProvider), 504, sttProvider)
          }
          segments = []
          transcriptText = ''
        } else {
          console.error('[analyze:error]', JSON.stringify({ provider: sttProvider, error: 'transcription-failed', model: sttModel }))
          throw new AnalyzeError(publicProviderError(sttProvider), 502, sttProvider)
        }
      }
    }
    transcriptionMs = elapsedMs(tStt)
    logDiag('transcription', {
      provider: sttProvider,
      model: sttModel,
      hasAudio: meta.hasAudio,
      audioDurationMs,
      videoDurationMs: meta.durationMs,
      segmentCount: segments.length,
      textChars: transcriptText.length,
      transcriptionMs
    })

    onProgress('analyzing_video', 'Analyzing visible UI in the recording…')
    const tVis = nowMs()
    const gemini = createGeminiProvider({
      apiKey: env.geminiApiKey,
      model: env.geminiModel,
      baseUrl: env.geminiBaseUrl
    })

    const transcriptForModel = segments
      .map((s) => `[${s.startMs}–${s.endMs}ms] ${s.text}`)
      .join('\n')

    let visual: VisualAnalysis
    let rawText = ''
    try {
      const first = await gemini.analyzeVideo({
        filePath: file.path,
        mimeType: 'video/mp4',
        transcriptText: transcriptForModel,
        durationMs: meta.durationMs
      })
      aiCallCount += 1
      visual = first.visual
      rawText = first.rawText
      geminiDelivery = first.delivery
      inputTokens = addTokens(inputTokens, first.usage.inputTokens)
      outputTokens = addTokens(outputTokens, first.usage.outputTokens)
      cachedInputTokens = addTokens(cachedInputTokens, first.usage.cachedInputTokens)
    } catch (err) {
      if (err instanceof GeminiParseError && retryCount === 0) {
        retryCount += 1
        logDiag('gemini-json-retry', { error: 'invalid-json' })
        try {
          const retry = await gemini.retryParse({
            rawText: err.rawText,
            errorMessage: err.message
          })
          aiCallCount += 1
          retryInput = retry.usage.inputTokens ?? 0
          retryOutput = retry.usage.outputTokens ?? 0
          inputTokens = addTokens(addTokens(inputTokens, err.usage.inputTokens), retry.usage.inputTokens)
          outputTokens = addTokens(addTokens(outputTokens, err.usage.outputTokens), retry.usage.outputTokens)
          cachedInputTokens = addTokens(cachedInputTokens, retry.usage.cachedInputTokens)
          visual = retry.visual
          rawText = retry.rawText
          geminiDelivery = retry.delivery
        } catch (retryErr) {
          throwGeminiFailure(retryErr, env.geminiModel)
        }
      } else {
        throwGeminiFailure(err, env.geminiModel)
      }
    }
    videoAnalysisMs = elapsedMs(tVis)
    logDiag('video-analysis', {
      model: env.geminiModel,
      delivery: geminiDelivery,
      inputTokens,
      outputTokens,
      visibleActions: visual.visibleActions.length,
      visibleFailures: visual.visibleFailures.length,
      contradictions: visual.speakerVisualContradictions.length,
      videoAnalysisMs,
      retryCount
    })

    onProgress('generating_report', 'Merging speech and screen evidence…')
    const tRep = nowMs()
    let merged = mergeEvidence({
      transcript: segments,
      visual,
      videoDurationMs: meta.durationMs
    })

    try {
      merged = { ...merged, report: validateReport(merged.report) }
    } catch (err) {
      if (retryCount >= 1) {
        throw new AnalyzeError('Report schema validation failed after one retry.', 502, 'gemini')
      }
      retryCount += 1
      try {
        const retry = await gemini.retryParse({
          rawText,
          errorMessage: err instanceof Error ? err.message : String(err)
        })
        aiCallCount += 1
        retryInput += retry.usage.inputTokens ?? 0
        retryOutput += retry.usage.outputTokens ?? 0
        inputTokens = addTokens(inputTokens, retry.usage.inputTokens)
        outputTokens = addTokens(outputTokens, retry.usage.outputTokens)
        cachedInputTokens = addTokens(cachedInputTokens, retry.usage.cachedInputTokens)
        visual = retry.visual
        merged = mergeEvidence({
          transcript: segments,
          visual,
          videoDurationMs: meta.durationMs
        })
        merged = { ...merged, report: validateReport(merged.report) }
      } catch {
        const parsed = bugReportSchema.safeParse(merged.report)
        if (!parsed.success) {
          throw new AnalyzeError(publicProviderError('gemini'), 502, 'gemini')
        }
        merged = { ...merged, report: parsed.data }
      }
    }
    reportGenerationMs = elapsedMs(tRep)

    const totalMs = elapsedMs(started)
    const usage = {
      aiCallCount,
      retryCount,
      inputTokens,
      outputTokens,
      retryInputTokens: retryInput,
      retryOutputTokens: retryOutput,
      audioDurationMs: audioDurationMs || (meta.hasAudio ? meta.durationMs : 0),
      videoDurationMs: meta.durationMs,
      segmentCount: segments.length,
      sttProvider,
      sttModel,
      geminiModel: env.geminiModel,
      geminiDelivery,
      cachedInputTokens
    }

    logDiag('report', {
      status: merged.report.status,
      steps: merged.report.steps.length,
      retryCount,
      totalMs
    })

    return {
      report: merged.report,
      events: merged.events,
      transcript: segments,
      visual,
      metrics: {
        timings: {
          uploadMs: validationMs,
          validationMs,
          transcriptionMs,
          videoAnalysisMs,
          reportGenerationMs,
          totalMs,
          timeToUsefulResultMs: totalMs
        },
        usage,
        cost: estimateCost(usage)
      }
    }
  } finally {
    await unlink(tmpWav).catch(() => undefined)
  }
}

function addTokens(current: number | null, next: number | null | undefined): number | null {
  if (next == null && current == null) return null
  return (current ?? 0) + (next ?? 0)
}

function logDiag(phase: string, data: Record<string, unknown>): void {
  console.log(`[analyze:${phase}]`, JSON.stringify(data))
}

function logProviderFailure(provider: 'groq' | 'gemini' | 'xai', err: unknown, model: string): void {
  const httpStatus = err instanceof ProviderHttpError ? err.httpStatus : undefined
  const kind = err instanceof GeminiParseError ? 'invalid-json' : err instanceof Error ? err.name : 'unknown'
  console.error('[analyze:error]', JSON.stringify({ provider, httpStatus, model, kind }))
}

function throwGeminiFailure(err: unknown, model: string): never {
  logProviderFailure('gemini', err, model)
  if (err instanceof ProviderHttpError && (err.httpStatus === 401 || err.httpStatus === 403)) {
    throw new AnalyzeError(publicAuthError('gemini'), 401, 'gemini')
  }
  throw new AnalyzeError(publicProviderError('gemini'), 502, 'gemini')
}

export { VideoValidationError }
