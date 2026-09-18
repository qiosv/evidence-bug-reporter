import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { VideoMetadata } from '../shared/types'

const execFileAsync = promisify(execFile)
export const MAX_DURATION_MS = 90_000

export class VideoValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VideoValidationError'
  }
}

export async function extractMetadata(filePath: string, mimeType: string): Promise<VideoMetadata> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filePath
      ],
      { windowsHide: true }
    )
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string }
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>
    }
    const durationSec = Number(parsed.format?.duration ?? 0)
    const videoStream = parsed.streams?.find((s) => s.codec_type === 'video')
    const hasAudio = Boolean(parsed.streams?.some((s) => s.codec_type === 'audio'))
    return {
      durationMs: Math.round(durationSec * 1000),
      hasAudio,
      width: videoStream?.width,
      height: videoStream?.height,
      mimeType
    }
  } catch (err) {
    throw new VideoValidationError(
      `Could not read video metadata. ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export function validateMetadata(meta: VideoMetadata, originalName: string): void {
  const lower = originalName.toLowerCase()
  const isMp4 = lower.endsWith('.mp4') || meta.mimeType.includes('mp4')
  if (!isMp4) {
    throw new VideoValidationError('Unsupported file format. Upload an MP4 recording.')
  }
  if (!meta.durationMs || meta.durationMs < 400) {
    throw new VideoValidationError('Empty or too-short video. The recording has no usable duration.')
  }
  if (meta.durationMs > MAX_DURATION_MS + 250) {
    throw new VideoValidationError(
      `Video is longer than 90 seconds (${(meta.durationMs / 1000).toFixed(1)}s). Trim the recording and retry.`
    )
  }
}

export async function extractAudioWav(inputPath: string, outputPath: string): Promise<boolean> {
  try {
    await execFileAsync(
      'ffmpeg',
      ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', outputPath],
      { windowsHide: true }
    )
    return true
  } catch {
    return false
  }
}
