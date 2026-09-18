function waitForEvent(target: HTMLMediaElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for video ${event}.`))
    }, timeoutMs)
    const onOk = (): void => {
      cleanup()
      resolve()
    }
    const onErr = (): void => {
      cleanup()
      reject(new Error('Failed to seek video for evidence screenshot.'))
    }
    const cleanup = (): void => {
      window.clearTimeout(timer)
      target.removeEventListener(event, onOk)
      target.removeEventListener('error', onErr)
    }
    target.addEventListener(event, onOk, { once: true })
    target.addEventListener('error', onErr, { once: true })
  })
}

export async function waitForVideoData(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0) return
  if (video.readyState >= 1 && video.videoWidth > 0 && Number.isFinite(video.duration)) {
    // HAVE_METADATA is enough to seek; wait for seeked later.
    return
  }
  await waitForEvent(video, 'loadedmetadata', 5000)
}

export async function seekToEvidence(video: HTMLVideoElement, timestampMs: number): Promise<void> {
  await waitForVideoData(video)
  const duration = Number.isFinite(video.duration) ? video.duration : timestampMs / 1000
  const target = Math.min(Math.max(0, timestampMs / 1000), Math.max(0, duration - 0.05))
  if (Math.abs(video.currentTime - target) < 0.04 && video.readyState >= 2) {
    return
  }
  const seeked = waitForEvent(video, 'seeked', 4000)
  video.pause()
  video.currentTime = target
  await seeked
}

function isMostlyBlack(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const sample = ctx.getImageData(0, 0, width, height)
  let sum = 0
  let count = 0
  for (let i = 0; i < sample.data.length; i += 64) {
    sum += sample.data[i] + sample.data[i + 1] + sample.data[i + 2]
    count += 1
  }
  return count > 0 && sum / count < 18
}

async function drawFrame(video: HTMLVideoElement): Promise<{ dataUrl: string; black: boolean }> {
  const canvas = document.createElement('canvas')
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) throw new Error('Video dimensions are not available yet.')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable.')
  ctx.drawImage(video, 0, 0, width, height)
  const black = isMostlyBlack(ctx, width, height)
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.72), black }
}

/** Seek, and if the frame is black/stale, search a small local window. Does not invent a new event time. */
export async function captureFrame(video: HTMLVideoElement, timestampMs: number): Promise<string> {
  const offsets = [0, -400, 400, -800, 800]
  let lastError: unknown
  for (const offset of offsets) {
    const candidate = Math.max(0, timestampMs + offset)
    try {
      await seekToEvidence(video, candidate)
      const frame = await drawFrame(video)
      if (!frame.black) return frame.dataUrl
    } catch (err) {
      lastError = err
    }
  }
  throw new Error(
    lastError instanceof Error ? lastError.message : 'Failed screenshot extraction for this timestamp.'
  )
}
