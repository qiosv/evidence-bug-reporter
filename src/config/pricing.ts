/**
 * Central pricing assumptions for variable AI cost estimation.
 * Free credits are not treated as $0 operating cost.
 *
 * Sources (update when providers change list prices):
 * - xAI Speech-to-Text REST: https://docs.x.ai/docs/models (Voice: $0.10 / hr REST)
 * - Groq Whisper: https://groq.com/pricing
 * - Gemini: https://ai.google.dev/pricing
 */

export interface ProviderPricing {
  /** Display name for the UI. */
  label: string
  /** ISO currency. */
  currency: 'USD'
}

export interface WhisperPricing extends ProviderPricing {
  /** USD per hour of audio. */
  usdPerHour: number
  model: string
}

export interface GeminiPricing extends ProviderPricing {
  /** USD per 1M input tokens (text + media, as billed by the API). */
  inputUsdPerMillionTokens: number
  /** USD per 1M output tokens. */
  outputUsdPerMillionTokens: number
  /**
   * Fallback video token estimate when the API does not return usage.
   * Gemini default video sampling is typically ~263 tokens/second.
   */
  videoTokensPerSecond: number
  model: string
}

export const PRICING = {
  currency: 'USD' as const,
  hostingNote:
    'Hosting (compute, bandwidth, storage) is separate from the variable AI cost below and is not included.',
  groqWhisper: {
    label: 'Groq Whisper',
    currency: 'USD',
    model: 'whisper-large-v3-turbo',
    /** Paid list price. Groq bills a 10-second minimum per request. */
    usdPerHour: 0.04
  } satisfies WhisperPricing,
  xaiStt: {
    label: 'xAI Speech-to-Text',
    currency: 'USD',
    model: 'xai-stt',
    /** Official REST Speech-to-Text list price (not streaming). */
    usdPerHour: 0.1
  } satisfies WhisperPricing,
  gemini: {
    label: 'Google Gemini',
    currency: 'USD',
    model: 'gemini-3.5-flash-lite',
    /** Paid list price for gemini-3.5-flash-lite (same published rates as retired 2.5 Flash). */
    inputUsdPerMillionTokens: 0.3,
    outputUsdPerMillionTokens: 2.5,
    videoTokensPerSecond: 263
  } satisfies GeminiPricing
} as const

export type PricingConfig = typeof PRICING
