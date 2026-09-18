import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { PRICING } from '../src/config/pricing'
import type { TranscriptionProviderId } from '../src/transcription/types'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
export const ENV_FILE_PATH = join(repoRoot, '.env')
export const ENV_SOURCE = '.env'

if (!existsSync(ENV_FILE_PATH)) {
  console.warn(`[env] ${ENV_SOURCE} is missing at project root. .env.example is a template only and will not be loaded.`)
} else {
  config({ path: ENV_FILE_PATH, override: true })
}

function cleanKey(value: string | undefined): string {
  const trimmed = (value ?? '').trim().replace(/^\uFEFF/, '')
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

function resolveTranscriptionProvider(raw: string | undefined): TranscriptionProviderId {
  const value = (raw ?? 'xai').trim().toLowerCase()
  return value === 'groq' ? 'groq' : 'xai'
}

export type ApiKeyMode = 'byok' | 'server'

function resolveApiKeyMode(raw: string | undefined): ApiKeyMode {
  return (raw ?? 'byok').trim().toLowerCase() === 'server' ? 'server' : 'byok'
}

export function requireEnv(): {
  groqApiKey: string
  geminiApiKey: string
  xaiApiKey: string
  groqBaseUrl: string
  groqModel: string
  geminiBaseUrl: string
  geminiModel: string
  xaiBaseUrl: string
  xaiSttModel: string
  transcriptionProvider: TranscriptionProviderId
  apiKeyMode: ApiKeyMode
  port: number
  envSource: typeof ENV_SOURCE
} {
  return {
    groqApiKey: cleanKey(process.env.GROQ_API_KEY),
    geminiApiKey: cleanKey(process.env.GEMINI_API_KEY),
    xaiApiKey: cleanKey(process.env.XAI_API_KEY),
    groqBaseUrl: process.env.GROQ_BASE_URL?.trim() || 'https://api.groq.com/openai/v1',
    groqModel: process.env.GROQ_STT_MODEL?.trim() || PRICING.groqWhisper.model,
    geminiBaseUrl:
      process.env.GEMINI_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com/v1beta',
    geminiModel: resolveGeminiModel(process.env.GEMINI_MODEL?.trim()),
    xaiBaseUrl: process.env.XAI_BASE_URL?.trim() || 'https://api.x.ai/v1',
    xaiSttModel: process.env.XAI_STT_MODEL?.trim() || PRICING.xaiStt.model,
    transcriptionProvider: resolveTranscriptionProvider(process.env.TRANSCRIPTION_PROVIDER),
    apiKeyMode: resolveApiKeyMode(process.env.API_KEY_MODE),
    port: Number(process.env.PORT) || 8787,
    envSource: ENV_SOURCE
  }
}

export function logEnvDiagnostics(env: ReturnType<typeof requireEnv>): void {
  console.log(`[env] source=${env.envSource} path_exists=${existsSync(ENV_FILE_PATH) ? 'yes' : 'no'}`)
  console.log(`[env] api_key_mode=${env.apiKeyMode}`)
  console.log(`[env] transcription_provider=${env.transcriptionProvider}`)
  if (env.apiKeyMode === 'byok') {
    console.log('xAI: user-supplied (server env key is not used for analysis)')
    console.log('Gemini: user-supplied (server env key is not used for analysis)')
  } else {
    console.log(`xAI: ${env.xaiApiKey ? 'configured' : 'missing'}`)
    console.log(`Groq: ${env.groqApiKey ? 'configured' : 'missing'}`)
    console.log(`Gemini: ${env.geminiApiKey ? 'configured' : 'missing'}`)
  }
}

function resolveGeminiModel(requested: string | undefined): string {
  if (!requested || requested === 'gemini-2.5-flash') {
    if (requested === 'gemini-2.5-flash') {
      console.warn(
        '[env] gemini-2.5-flash is unavailable to new Gemini API keys; using',
        PRICING.gemini.model
      )
    }
    return PRICING.gemini.model
  }
  return requested
}
