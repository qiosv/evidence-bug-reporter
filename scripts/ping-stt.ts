import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireEnv } from '../server/env'
import { createSttProvider, sttIsConfigured, activeSttModel } from '../src/transcription/select'
import { extractAudioWav } from '../src/video/metadata'
import { ProviderHttpError } from '../src/lib/providerError'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function main(): Promise<void> {
  const env = requireEnv()
  console.log(`xAI configured: ${env.xaiApiKey ? 'yes' : 'no'}`)
  console.log(`transcription_provider=${env.transcriptionProvider}`)
  console.log(`stt_model=${activeSttModel(env)}`)
  console.log(`Gemini configured: ${env.geminiApiKey ? 'yes' : 'no'}`)
  if (!sttIsConfigured(env)) {
    console.error('STT provider is not configured.')
    process.exit(2)
  }

  mkdirSync(join(ROOT, 'tmp'), { recursive: true })
  const mp4 = join(ROOT, 'tests/fixtures/test-a.mp4')
  const wav = join(ROOT, 'tmp', 'xai-ping.wav')
  const wavOk = await extractAudioWav(mp4, wav)
  const stt = createSttProvider(env)
  const started = Date.now()
  try {
    const result = await stt.transcribe(wavOk ? wav : mp4, wavOk ? 'audio/wav' : 'video/mp4')
    const wordCount =
      result.wordCount ?? result.segments.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0)
    console.log('STT HTTP status: 200')
    console.log(`duration_ms_audio: ${result.durationMs}`)
    console.log(`word_count: ${wordCount}`)
    console.log(`segment_count: ${result.segments.length}`)
    console.log(`transcription_latency_ms: ${Date.now() - started}`)
    console.log(`language: ${result.language ?? 'n/a'}`)
  } catch (err) {
    const http = err instanceof ProviderHttpError ? err.httpStatus : 'n/a'
    console.error(`STT HTTP status: ${http}`)
    console.error(`transcription_latency_ms: ${Date.now() - started}`)
    console.error('Transcription provider request failed')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'STT ping failed')
  process.exit(1)
})
