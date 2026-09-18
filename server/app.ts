import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeRecording, AnalyzeError } from './analyze'
import { VideoValidationError, extractAudioWav, extractMetadata, validateMetadata } from '../src/video/metadata'
import { pingGroqModels } from '../src/transcription/groq'
import { activeSttModel, createSttProvider, sttIsConfigured } from '../src/transcription/select'
import { ProviderHttpError } from '../src/lib/providerError'
import { USER_GEMINI_KEY_HEADER, USER_XAI_KEY_HEADER } from '../src/shared/credentialHeaders'
import type { WorkflowPhase } from '../src/shared/types'
import type { AppEnv } from './requestCredentials'
import { CredentialsError, resolveRequestCredentials, scopedProviderEnv } from './requestCredentials'
import { pingGemini, pingXai } from './providerPing'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

export function createApp(env: AppEnv): express.Express {
  const app = express()
  mkdirSync(join(repoRoot, 'tmp'), { recursive: true })
  const upload = multer({
    dest: join(repoRoot, 'tmp'),
    limits: { fileSize: 80 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = file.mimetype.includes('mp4') || file.originalname.toLowerCase().endsWith('.mp4')
      if (ok) cb(null, true)
      else cb(new Error('Unsupported file format. Upload an MP4 recording.'))
    }
  })
  const audioUpload = multer({
    dest: join(repoRoot, 'tmp'),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const name = file.originalname.toLowerCase()
      const ok =
        /audio|webm|ogg|opus|wav|mp4/i.test(file.mimetype) || /\.(webm|ogg|wav|mp3|m4a|mp4|opus)$/.test(name)
      if (ok) cb(null, true)
      else cb(new Error('Unsupported live audio chunk.'))
    }
  })

  app.use(
    cors({
      allowedHeaders: ['Content-Type', USER_XAI_KEY_HEADER, USER_GEMINI_KEY_HEADER]
    })
  )
  app.use(express.json({ limit: '2mb' }))
  app.use('/fixtures', express.static(join(repoRoot, 'tests/fixtures')))

  app.get('/api/health', (_req, res) => {
    const payload: Record<string, unknown> = {
      ok: true,
      apiKeyMode: env.apiKeyMode,
      envSource: env.envSource,
      transcriptionProvider: env.transcriptionProvider,
      models: {
        stt: activeSttModel(env),
        video: env.geminiModel
      }
    }
    if (env.apiKeyMode === 'server') {
      payload.xai = env.xaiApiKey ? 'configured' : 'missing'
      payload.groq = env.groqApiKey ? 'configured' : 'missing'
      payload.gemini = env.geminiApiKey ? 'configured' : 'missing'
    } else {
      payload.xai = 'user'
      payload.groq = 'unused'
      payload.gemini = 'user'
    }
    res.json(payload)
  })

  app.post('/api/providers/test', async (req, res) => {
    try {
      const creds = resolveRequestCredentials(req.headers, env)
      const [xai, gemini] = await Promise.all([
        pingXai(creds.xaiApiKey, env.xaiBaseUrl),
        pingGemini(creds.geminiApiKey, env.geminiBaseUrl)
      ])
      res.json({
        xai: xai.status,
        gemini: gemini.status,
        ...(xai.error ? { xaiError: xai.error } : {}),
        ...(gemini.error ? { geminiError: gemini.error } : {})
      })
    } catch (error) {
      if (error instanceof CredentialsError) {
        res.status(error.status).json({ error: error.message })
        return
      }
      res.status(502).json({ error: 'Provider connection test failed.' })
    }
  })

  app.get('/api/providers/groq', async (_req, res) => {
    if (env.apiKeyMode === 'byok') {
      res.status(503).json({ provider: 'groq', error: 'not configured' })
      return
    }
    if (!env.groqApiKey) {
      res.status(503).json({ provider: 'groq', envSource: env.envSource, http: 503, error: 'not configured' })
      return
    }
    const started = Date.now()
    try {
      const http = await pingGroqModels({
        apiKey: env.groqApiKey,
        baseUrl: env.groqBaseUrl,
        model: env.groqModel
      })
      res.status(http === 200 ? 200 : 502).json({
        provider: 'groq',
        envSource: env.envSource,
        model: env.groqModel,
        http,
        duration_ms: Date.now() - started
      })
    } catch {
      res.status(502).json({
        provider: 'groq',
        envSource: env.envSource,
        error: 'Transcription provider request failed'
      })
    }
  })

  app.post('/api/providers/stt/transcribe-ping', async (req, res) => {
    let scoped: AppEnv
    try {
      scoped = scopedProviderEnv(env, resolveRequestCredentials(req.headers, env))
    } catch (error) {
      if (error instanceof CredentialsError) {
        res.status(error.status).json({ error: error.message })
        return
      }
      throw error
    }
    if (!sttIsConfigured(scoped)) {
      res.status(503).json({
        provider: scoped.transcriptionProvider,
        error: 'not configured'
      })
      return
    }
    const fixture = join(repoRoot, 'tests/fixtures/test-a.mp4')
    const wav = join(repoRoot, 'tmp', 'stt-ping.wav')
    const started = Date.now()
    const model = activeSttModel(scoped)
    try {
      const wavOk = await extractAudioWav(fixture, wav)
      const stt = createSttProvider(scoped)
      const result = await stt.transcribe(wavOk ? wav : fixture, wavOk ? 'audio/wav' : 'video/mp4')
      res.json({
        provider: scoped.transcriptionProvider,
        envSource: scoped.envSource,
        model,
        http: 200,
        duration_ms: Date.now() - started,
        audioDurationMs: result.durationMs,
        segmentCount: result.segments.length,
        wordCount:
          result.wordCount ?? result.segments.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0),
        textChars: result.text.length,
        language: result.language ?? null
      })
    } catch (err) {
      const http = err instanceof ProviderHttpError ? err.httpStatus : 502
      res.status(http === 401 || http === 403 ? http : 502).json({
        provider: scoped.transcriptionProvider,
        envSource: scoped.envSource,
        model,
        http,
        error:
          http === 401 || http === 403
            ? 'xAI authentication failed. Check your API key.'
            : 'Transcription provider request failed',
        duration_ms: Date.now() - started
      })
    }
  })

  app.post('/api/live/transcribe', (req, res) => {
    audioUpload.single('audio')(req, res, async (err) => {
      if (err) {
        res.status(400).json({ ok: false, error: err.message || 'Audio upload failed.' })
        return
      }
      let scoped: AppEnv
      try {
        scoped = scopedProviderEnv(env, resolveRequestCredentials(req.headers, env))
      } catch (error) {
        if (error instanceof CredentialsError) {
          res.status(error.status).json({ ok: false, error: error.message })
          return
        }
        throw error
      }
      if (!sttIsConfigured(scoped)) {
        res.status(503).json({ ok: false, error: 'Speech transcription provider is not configured.' })
        return
      }
      const file = req.file
      if (!file) {
        res.status(400).json({ ok: false, error: 'No audio chunk uploaded.' })
        return
      }
      const wav = join(repoRoot, 'tmp', `live-${randomUUID()}.wav`)
      const started = Date.now()
      try {
        const wavOk = await extractAudioWav(file.path, wav)
        const stt = createSttProvider(scoped)
        const mime = wavOk ? 'audio/wav' : file.mimetype || 'audio/webm'
        const result = await stt.transcribe(wavOk ? wav : file.path, mime)
        res.json({
          ok: true,
          provider: scoped.transcriptionProvider,
          model: activeSttModel(scoped),
          text: result.text,
          language: result.language ?? null,
          durationMs: result.durationMs,
          wordCount: result.wordCount ?? 0,
          latencyMs: Date.now() - started
        })
      } catch (error) {
        const http = error instanceof ProviderHttpError ? error.httpStatus : 502
        console.error(
          '[api:live-transcribe]',
          JSON.stringify({
            provider: scoped.transcriptionProvider,
            http,
            kind: error instanceof Error ? error.name : 'unknown'
          })
        )
        res.status(http === 401 || http === 403 ? http : 502).json({
          ok: false,
          error:
            http === 401 || http === 403
              ? 'xAI authentication failed. Check your API key.'
              : 'Transcription provider request failed'
        })
      } finally {
        await unlink(file.path).catch(() => undefined)
        await unlink(wav).catch(() => undefined)
      }
    })
  })

  app.post('/api/analyze', (req, res) => {
    upload.single('video')(req, res, async (err) => {
      if (err) {
        res.status(400).json({ ok: false, error: err.message || 'Upload failed.' })
        return
      }
      const file = req.file
      if (!file) {
        res.status(400).json({ ok: false, error: 'No MP4 file uploaded.' })
        return
      }

      try {
        const meta = await extractMetadata(file.path, file.mimetype || 'video/mp4')
        validateMetadata(meta, file.originalname)
      } catch (error) {
        await unlink(file.path).catch(() => undefined)
        const message = error instanceof VideoValidationError ? error.message : 'Could not read video metadata.'
        res.status(400).json({ ok: false, error: message })
        return
      }

      let scoped: AppEnv
      try {
        scoped = scopedProviderEnv(env, resolveRequestCredentials(req.headers, env))
      } catch (error) {
        await unlink(file.path).catch(() => undefined)
        if (error instanceof CredentialsError) {
          res.status(error.status).json({ ok: false, error: error.message })
          return
        }
        throw error
      }

      res.status(200)
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders?.()

      const send = (payload: unknown): void => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
      }

      const onProgress = (phase: WorkflowPhase, message: string): void => {
        send({ type: 'progress', phase, message })
      }

      try {
        const result = await analyzeRecording(
          {
            path: file.path,
            originalName: file.originalname,
            mimeType: file.mimetype || 'video/mp4'
          },
          scoped,
          onProgress
        )
        send({ type: 'result', data: result })
      } catch (error) {
        const message =
          error instanceof VideoValidationError
            ? error.message
            : error instanceof AnalyzeError
              ? error.message
              : 'Analysis failed.'
        const status =
          error instanceof AnalyzeError
            ? error.status
            : error instanceof VideoValidationError
              ? 400
              : 500
        const provider = error instanceof AnalyzeError ? error.provider : undefined
        if (!(error instanceof VideoValidationError)) {
          console.error(
            '[api:analyze]',
            JSON.stringify({
              provider: provider ?? 'server',
              status,
              kind: error instanceof Error ? error.name : 'unknown'
            })
          )
        }
        send({ type: 'error', error: message, status, provider })
      } finally {
        await unlink(file.path).catch(() => undefined)
        res.end()
      }
    })
  })

  const clientDist = join(repoRoot, 'dist/client')
  app.use(express.static(clientDist))
  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    if (req.path.startsWith('/fixtures')) return next()
    res.sendFile(join(clientDist, 'index.html'), (err) => {
      if (err) next()
    })
  })

  return app
}
