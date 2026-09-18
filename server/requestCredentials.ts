import type { IncomingHttpHeaders } from 'node:http'
import { USER_GEMINI_KEY_HEADER, USER_XAI_KEY_HEADER } from '../src/shared/credentialHeaders'
import type { ApiKeyMode, requireEnv } from './env'

export type { ApiKeyMode }
export type AppEnv = ReturnType<typeof requireEnv>

export class CredentialsError extends Error {
  status: number
  constructor(message: string, status = 401) {
    super(message)
    this.name = 'CredentialsError'
    this.status = status
  }
}

export interface RequestCredentials {
  xaiApiKey: string
  geminiApiKey: string
  groqApiKey: string
  source: ApiKeyMode
}

function headerValue(headers: IncomingHttpHeaders, name: string): string {
  const raw = headers[name.toLowerCase()]
  const value = Array.isArray(raw) ? raw[0] : raw
  return (value ?? '').trim()
}

/**
 * Resolve provider credentials for one request.
 * BYOK uses only request headers. SERVER uses only process env.
 * The two sources are never mixed.
 */
export function resolveRequestCredentials(
  headers: IncomingHttpHeaders,
  env: AppEnv
): RequestCredentials {
  if (env.apiKeyMode === 'byok') {
    const xaiApiKey = headerValue(headers, USER_XAI_KEY_HEADER)
    const geminiApiKey = headerValue(headers, USER_GEMINI_KEY_HEADER)
    if (!xaiApiKey && !geminiApiKey) {
      throw new CredentialsError(
        'xAI and Gemini API keys are required. Configure them in API Configuration.'
      )
    }
    if (!xaiApiKey) {
      throw new CredentialsError('xAI API key is required. Configure it in API Configuration.')
    }
    if (!geminiApiKey) {
      throw new CredentialsError('Gemini API key is required. Configure it in API Configuration.')
    }
    return { xaiApiKey, geminiApiKey, groqApiKey: '', source: 'byok' }
  }

  if (!env.xaiApiKey && env.transcriptionProvider === 'xai') {
    throw new CredentialsError('Speech transcription provider is not configured.', 503)
  }
  if (!env.geminiApiKey) {
    throw new CredentialsError('Video analysis provider is not configured.', 503)
  }
  return {
    xaiApiKey: env.xaiApiKey,
    geminiApiKey: env.geminiApiKey,
    groqApiKey: env.groqApiKey,
    source: 'server'
  }
}

/** Request-scoped copy. Never mutates process.env or the shared server env object. */
export function scopedProviderEnv(env: AppEnv, creds: RequestCredentials): AppEnv {
  return {
    ...env,
    xaiApiKey: creds.xaiApiKey,
    geminiApiKey: creds.geminiApiKey,
    groqApiKey: creds.source === 'server' ? creds.groqApiKey : ''
  }
}
