/** Redact credential-like substrings from text that may be logged or returned. */
export function sanitizeSecrets(text: string): string {
  return text
    .replace(/gsk_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\bxai-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/AIza[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/([?&]key=)[^&\s"'\\]+/gi, '$1[redacted]')
    .replace(/\b(GROQ_API_KEY|GEMINI_API_KEY|XAI_API_KEY)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .replace(/\b(X-User-XAI-Key|X-User-Gemini-Key)\s*[=:]\s*\S+/gi, '$1=[redacted]')
}

export function publicProviderError(provider: 'groq' | 'gemini' | 'xai'): string {
  return provider === 'gemini'
    ? 'Video analysis provider request failed'
    : 'Transcription provider request failed'
}

export function publicAuthError(provider: 'groq' | 'gemini' | 'xai'): string {
  if (provider === 'gemini') return 'Gemini authentication failed. Check your API key.'
  if (provider === 'xai') return 'xAI authentication failed. Check your API key.'
  return 'Transcription authentication failed. Check your API key.'
}
