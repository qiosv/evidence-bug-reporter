import { PRICING } from '../config/pricing'
import type { CostBreakdown, UsageMetrics } from '../shared/types'

/**
 * Variable cost from measured usage × configured list prices.
 * Retry tokens are billed as their own line and are not added twice.
 */
export function estimateCost(usage: UsageMetrics): CostBreakdown {
  const sttProvider = usage.sttProvider ?? 'xai'
  const sttUsdPerHour =
    sttProvider === 'groq' ? PRICING.groqWhisper.usdPerHour : PRICING.xaiStt.usdPerHour
  const billedAudioMs =
    usage.audioDurationMs > 0
      ? sttProvider === 'groq'
        ? Math.max(usage.audioDurationMs, 10_000)
        : usage.audioDurationMs
      : 0
  const audioHours = billedAudioMs / 3_600_000
  const sttUsd = audioHours * sttUsdPerHour

  const primaryInput =
    usage.inputTokens == null ? null : Math.max(0, usage.inputTokens - usage.retryInputTokens)
  const primaryOutput =
    usage.outputTokens == null ? null : Math.max(0, usage.outputTokens - usage.retryOutputTokens)

  const inputForPrice =
    primaryInput ?? Math.round((usage.videoDurationMs / 1000) * PRICING.gemini.videoTokensPerSecond)
  const outputForPrice = primaryOutput ?? 0

  const videoInputUsd = (inputForPrice / 1_000_000) * PRICING.gemini.inputUsdPerMillionTokens
  const modelOutputUsd = (outputForPrice / 1_000_000) * PRICING.gemini.outputUsdPerMillionTokens
  const retryUsd =
    (usage.retryInputTokens / 1_000_000) * PRICING.gemini.inputUsdPerMillionTokens +
    (usage.retryOutputTokens / 1_000_000) * PRICING.gemini.outputUsdPerMillionTokens

  const totalVariableUsd = sttUsd + videoInputUsd + modelOutputUsd + retryUsd

  return {
    currency: 'USD',
    sttUsd: roundUsd(sttUsd),
    videoInputUsd: roundUsd(videoInputUsd),
    modelOutputUsd: roundUsd(modelOutputUsd),
    retryUsd: roundUsd(retryUsd),
    totalVariableUsd: roundUsd(totalVariableUsd),
    hostingNote: PRICING.hostingNote,
    assumptions: {
      groqWhisperUsdPerHour: PRICING.groqWhisper.usdPerHour,
      sttUsdPerHour,
      sttProvider,
      geminiInputUsdPerMillion: PRICING.gemini.inputUsdPerMillionTokens,
      geminiOutputUsdPerMillion: PRICING.gemini.outputUsdPerMillionTokens,
      geminiModel: usage.geminiModel || PRICING.gemini.model,
      groqModel: usage.sttModel || (sttProvider === 'groq' ? PRICING.groqWhisper.model : PRICING.xaiStt.model)
    }
  }
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000
}

export function formatUsd(n: number): string {
  if (n === 0) return '$0.000000 (measured usage was empty — not “free credits”)'
  if (n < 0.01) return `$${n.toFixed(6)}`
  return `$${n.toFixed(4)}`
}
