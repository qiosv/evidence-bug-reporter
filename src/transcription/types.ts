import type { TranscriptSegment } from '../shared/types'

export interface SttProvider {
  transcribe(filePath: string, mimeType: string): Promise<{
    text: string
    segments: TranscriptSegment[]
    durationMs: number
    language?: string
    wordCount?: number
  }>
}

export type TranscriptionProviderId = 'xai' | 'groq'
