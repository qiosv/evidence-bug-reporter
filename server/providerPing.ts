import { fetchWithTimeout } from '../src/lib/fetchWithTimeout'

export type ConnectionStatus = 'connected' | 'invalid' | 'error'

export interface ProviderPingResult {
  provider: 'xai' | 'gemini'
  status: ConnectionStatus
  error?: string
}

function classify(httpStatus: number): ConnectionStatus {
  if (httpStatus === 200) return 'connected'
  if (httpStatus === 401 || httpStatus === 403) return 'invalid'
  return 'error'
}

function sanitizedError(status: ConnectionStatus, provider: 'xai' | 'gemini'): string | undefined {
  if (status === 'connected') return undefined
  if (status === 'invalid') {
    return provider === 'gemini'
      ? 'Gemini authentication failed. Check your API key.'
      : 'xAI authentication failed. Check your API key.'
  }
  return provider === 'gemini' ? 'Gemini connection failed.' : 'xAI connection failed.'
}

export async function pingXai(apiKey: string, baseUrl: string): Promise<ProviderPingResult> {
  if (!apiKey) {
    return {
      provider: 'xai',
      status: 'invalid',
      error: 'xAI API key is required. Configure it in API Configuration.'
    }
  }
  try {
    const res = await fetchWithTimeout(
      `${baseUrl.replace(/\/$/, '')}/models`,
      { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } },
      15_000
    )
    const status = classify(res.status)
    return { provider: 'xai', status, error: sanitizedError(status, 'xai') }
  } catch {
    return { provider: 'xai', status: 'error', error: 'xAI connection failed.' }
  }
}

export async function pingGemini(apiKey: string, baseUrl: string): Promise<ProviderPingResult> {
  if (!apiKey) {
    return {
      provider: 'gemini',
      status: 'invalid',
      error: 'Gemini API key is required. Configure it in API Configuration.'
    }
  }
  try {
    const res = await fetchWithTimeout(
      `${baseUrl.replace(/\/$/, '')}/models`,
      { method: 'GET', headers: { 'x-goog-api-key': apiKey } },
      15_000
    )
    const status = classify(res.status)
    return { provider: 'gemini', status, error: sanitizedError(status, 'gemini') }
  } catch {
    return { provider: 'gemini', status: 'error', error: 'Gemini connection failed.' }
  }
}
