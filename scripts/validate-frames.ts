import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { AnalyzeSuccess } from '../src/shared/types'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tests/results')
const BASE = process.env.APP_URL ?? 'http://localhost:5173'

function importantTimestamps(result: AnalyzeSuccess): Array<{ label: string; ms: number }> {
  const items: Array<{ label: string; ms: number }> = []
  for (const s of result.report.startingConditions) {
    if (typeof s.timestampMs === 'number') items.push({ label: `start:${s.text.slice(0, 40)}`, ms: s.timestampMs })
  }
  for (const s of result.report.steps) {
    const ms = s.frameTimestampMs ?? s.timestampMs
    if (typeof ms === 'number') items.push({ label: `step${s.index}`, ms })
  }
  if (typeof result.report.observedFailure?.timestampMs === 'number') {
    items.push({ label: 'failure', ms: result.report.observedFailure.timestampMs })
  }
  const seen = new Set<number>()
  return items.filter((i) => {
    if (seen.has(i.ms)) return false
    seen.add(i.ms)
    return true
  })
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const ids = ['test-a', 'test-b', 'test-c', 'new-input']
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage()
  const summary: unknown[] = []

  for (const id of ids) {
    const reportPath = join(OUT, `${id}.actual.json`)
    if (!existsSync(reportPath)) {
      summary.push({ id, ok: false, detail: 'missing actual.json' })
      continue
    }
    const result = JSON.parse(readFileSync(reportPath, 'utf8')) as AnalyzeSuccess
    const stamps = importantTimestamps(result).slice(0, 8)
    await page.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded' })
    const captured = await page.evaluate(
      async ({ videoUrl, stamps: ts }) => {
        const video = document.createElement('video')
        video.src = videoUrl
        video.muted = true
        video.playsInline = true
        document.body.appendChild(video)
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error('loadedmetadata timeout')), 8000)
          video.onloadedmetadata = () => {
            window.clearTimeout(timer)
            resolve()
          }
          video.onerror = () => reject(new Error('video error'))
        })
        const width = video.videoWidth
        const height = video.videoHeight
        const durationMs = Math.round(video.duration * 1000)
        const frames: Array<{
          label: string
          reportedTimestamp: number
          evidenceFrameTimestamp: number
          black: boolean
          width: number
          height: number
        }> = []
        for (const stamp of ts) {
          const offsets = [0, -400, 400, -800, 800, -1500, 1500]
          let chosen = stamp.ms
          let black = true
          for (const offset of offsets) {
            const candidate = Math.min(Math.max(0, stamp.ms + offset), Math.max(0, durationMs - 50))
            await new Promise<void>((resolve, reject) => {
              const timer = window.setTimeout(() => reject(new Error('seeked timeout')), 4000)
              video.onseeked = () => {
                window.clearTimeout(timer)
                resolve()
              }
              video.currentTime = candidate / 1000
            })
            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height
            const ctx = canvas.getContext('2d')
            if (!ctx) throw new Error('no canvas')
            ctx.drawImage(video, 0, 0, width, height)
            const sample = ctx.getImageData(0, 0, width, height)
            let sum = 0
            let count = 0
            for (let i = 0; i < sample.data.length; i += 64) {
              sum += sample.data[i] + sample.data[i + 1] + sample.data[i + 2]
              count += 1
            }
            const isBlack = count > 0 && sum / count < 18
            if (!isBlack) {
              chosen = candidate
              black = false
              break
            }
          }
          frames.push({
            label: stamp.label,
            reportedTimestamp: stamp.ms,
            evidenceFrameTimestamp: chosen,
            black,
            width,
            height
          })
        }
        video.remove()
        return { width, height, durationMs, frames }
      },
      { videoUrl: `${BASE}/fixtures/${id}.mp4`, stamps }
    )

    const ok =
      captured.width > 0 &&
      captured.height > 0 &&
      captured.frames.length > 0 &&
      captured.frames.every((f) => !f.black)
    summary.push({ id, ok, ...captured })
    console.log(`${ok ? 'PASS' : 'FAIL'} ${id} frames=${captured.frames.length} ${captured.width}x${captured.height}`)
  }

  await browser.close()
  writeFileSync(join(OUT, 'frames.json'), JSON.stringify(summary, null, 2))
  if (summary.some((row) => typeof row === 'object' && row && 'ok' in row && !(row as { ok: boolean }).ok)) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
