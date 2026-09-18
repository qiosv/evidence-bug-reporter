export class ProviderHttpError extends Error {
  provider: 'groq' | 'gemini' | 'xai'
  httpStatus: number

  constructor(provider: 'groq' | 'gemini' | 'xai', httpStatus: number) {
    super(
      provider === 'gemini'
        ? 'Video analysis provider request failed'
        : 'Transcription provider request failed'
    )
    this.name = 'ProviderHttpError'
    this.provider = provider
    this.httpStatus = httpStatus
  }
}
