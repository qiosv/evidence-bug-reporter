import { createGroqStt } from './groq'
import { createXaiStt } from './xai'
import type { SttProvider, TranscriptionProviderId } from './types'

export function createSttProvider(env: {
  transcriptionProvider: TranscriptionProviderId
  xaiApiKey: string
  xaiBaseUrl: string
  xaiSttModel: string
  groqApiKey: string
  groqBaseUrl: string
  groqModel: string
}): SttProvider {
  if (env.transcriptionProvider === 'groq') {
    return createGroqStt({
      apiKey: env.groqApiKey,
      baseUrl: env.groqBaseUrl,
      model: env.groqModel
    })
  }
  return createXaiStt({
    apiKey: env.xaiApiKey,
    baseUrl: env.xaiBaseUrl,
    model: env.xaiSttModel
  })
}

export function sttIsConfigured(env: {
  transcriptionProvider: TranscriptionProviderId
  xaiApiKey: string
  groqApiKey: string
}): boolean {
  return env.transcriptionProvider === 'groq' ? Boolean(env.groqApiKey) : Boolean(env.xaiApiKey)
}

export function activeSttModel(env: {
  transcriptionProvider: TranscriptionProviderId
  xaiSttModel: string
  groqModel: string
}): string {
  return env.transcriptionProvider === 'groq' ? env.groqModel : env.xaiSttModel
}
