import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'tests/fixtures')
const WORK = join(ROOT, 'tmp/fixtures')
const BASE = process.env.APP_URL ?? 'http://localhost:5173'

mkdirSync(OUT, { recursive: true })
mkdirSync(WORK, { recursive: true })

function run(cmd: string, args: string[]): void {
  const res = spawnSync(cmd, args, { stdio: 'inherit', windowsHide: true })
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`)
}

function tts(text: string, wavPath: string): void {
  const escaped = text.replace(/'/g, "''")
  const posix = wavPath.replaceAll('\\', '/')
  const script = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = -1
$s.SetOutputToWaveFile('${posix}')
$s.Speak('${escaped}')
$s.Dispose()
`
  const res = spawnSync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true })
  if (res.status !== 0) throw new Error(`TTS failed for ${wavPath}`)
}

function silence(seconds: number, wavPath: string): void {
  run('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=16000:cl=mono',
    '-t',
    String(seconds),
    wavPath
  ])
}

function concatAudio(files: string[], outPath: string): void {
  const normalized = files.map((f, i) => {
    const out = join(WORK, `norm-${i}-${Date.now()}.wav`)
    run('ffmpeg', ['-y', '-i', f, '-ar', '16000', '-ac', '1', out])
    return out
  })
  const list = join(WORK, `concat-audio-${Date.now()}.txt`)
  writeFileSync(list, normalized.map((f) => `file '${f.replaceAll('\\', '/')}'`).join('\n'))
  run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-ar', '16000', '-ac', '1', outPath])
}

function slideshow(frames: Array<{ file: string; seconds: number }>, outMp4: string, audio: string): void {
  const list = join(WORK, `concat-video-${Date.now()}.txt`)
  const lines: string[] = []
  for (const frame of frames) {
    lines.push(`file '${frame.file.replaceAll('\\', '/')}'`)
    lines.push(`duration ${frame.seconds}`)
  }
  lines.push(`file '${frames[frames.length - 1].file.replaceAll('\\', '/')}'`)
  writeFileSync(list, lines.join('\n'))
  const raw = join(WORK, `raw-${Date.now()}.mp4`)
  run('ffmpeg', [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-r',
    '2',
    '-pix_fmt',
    'yuv420p',
    raw
  ])
  run('ffmpeg', [
    '-y',
    '-i',
    raw,
    '-i',
    audio,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    outMp4
  ])
}

async function waitForApp(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(BASE)
      if (res.ok) return
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Demo app is not running at ${BASE}. Start npm run dev first.`)
}

async function main(): Promise<void> {
  await waitForApp()
  let browser
  const channels = [process.env.PW_CHANNEL, 'chrome', 'msedge', undefined].filter(
    (v, i, arr) => v !== undefined || i === arr.length - 1
  )
  const unique = [...new Set(channels)]
  let lastErr: unknown
  for (const channel of unique) {
    try {
      browser = await chromium.launch(channel ? { headless: true, channel } : { headless: true })
      break
    } catch (err) {
      lastErr = err
    }
  }
  if (!browser) throw lastErr ?? new Error('Could not launch a browser for fixture capture')
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })

  const shot = async (name: string): Promise<string> => {
    const file = join(WORK, name)
    await page.screenshot({ path: file })
    return file
  }

  const newOnly = process.argv.includes('--new-only')

  if (!newOnly) {
    // --- Test A: defect on, full narration ---
    await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid="selected-filter"]')
    const a1 = await shot('a1.png')
    await page.click('[data-testid="filter-active"]')
    await page.waitForTimeout(400)
    const a2 = await shot('a2.png')
    await page.click('[data-testid="page-2"]')
    await page.waitForTimeout(400)
    const a3 = await shot('a3.png')

    tts('The catalog is open. Status filter is All.', join(WORK, 'a-n1.wav'))
    tts('I am changing the status filter to Active. Only active products are shown.', join(WORK, 'a-n2.wav'))
    tts('Now I click page two. The filter reset back to All. That is the bug.', join(WORK, 'a-n3.wav'))
    concatAudio(
      [join(WORK, 'a-n1.wav'), join(WORK, 'a-n2.wav'), join(WORK, 'a-n3.wav')],
      join(WORK, 'a-audio.wav')
    )
    slideshow(
      [
        { file: a1, seconds: 3.2 },
        { file: a2, seconds: 4.2 },
        { file: a3, seconds: 5.2 }
      ],
      join(OUT, 'test-a.mp4'),
      join(WORK, 'a-audio.wav')
    )

    // --- Test B: silent actions ---
    await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' })
    const b1 = await shot('b1.png')
    await page.click('[data-testid="filter-active"]')
    await page.waitForTimeout(400)
    const b2 = await shot('b2.png')
    await page.click('[data-testid="page-2"]')
    await page.waitForTimeout(400)
    const b3 = await shot('b3.png')
    tts('I will reproduce the issue.', join(WORK, 'b-n1.wav'))
    silence(4, join(WORK, 'b-sil.wav'))
    tts('The filter reset.', join(WORK, 'b-n2.wav'))
    concatAudio(
      [join(WORK, 'b-n1.wav'), join(WORK, 'b-sil.wav'), join(WORK, 'b-n2.wav')],
      join(WORK, 'b-audio.wav')
    )
    slideshow(
      [
        { file: b1, seconds: 3 },
        { file: b2, seconds: 4 },
        { file: b3, seconds: 4 }
      ],
      join(OUT, 'test-b.mp4'),
      join(WORK, 'b-audio.wav')
    )

    // --- Test C: defect off, unsupported claim ---
    await page.goto(`${BASE}/demo?defect=off`, { waitUntil: 'networkidle' })
    const c1 = await shot('c1.png')
    await page.click('[data-testid="filter-active"]')
    await page.waitForTimeout(400)
    const c2 = await shot('c2.png')
    await page.click('[data-testid="page-2"]')
    await page.waitForTimeout(400)
    const c3 = await shot('c3.png')
    tts('The catalog is open. I set Active and open page two.', join(WORK, 'c-n1.wav'))
    tts('The filter reset.', join(WORK, 'c-n2.wav'))
    concatAudio([join(WORK, 'c-n1.wav'), join(WORK, 'c-n2.wav')], join(WORK, 'c-audio.wav'))
    slideshow(
      [
        { file: c1, seconds: 3.5 },
        { file: c2, seconds: 3.5 },
        { file: c3, seconds: 5 }
      ],
      join(OUT, 'test-c.mp4'),
      join(WORK, 'c-audio.wav')
    )
  }

  // --- New arbitrary input (no ground-truth JSON) ---
  await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="page-2"]')
  const n1 = await shot('n1.png')
  await page.click('[data-testid="page-2"]')
  await page.waitForTimeout(400)
  const n2 = await shot('n2.png')
  tts('I open the catalog and go straight to page two without changing the status filter.', join(WORK, 'n-audio.wav'))
  slideshow(
    [
      { file: n1, seconds: 4 },
      { file: n2, seconds: 6 }
    ],
    join(OUT, 'new-input.mp4'),
    join(WORK, 'n-audio.wav')
  )

  const silentWav = (name: string, seconds: number): string => {
    const file = join(WORK, name)
    silence(seconds, file)
    return file
  }

  // Silent catalog defect — speech optional; this file has none.
  await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="filter-active"]')
  const s1 = await shot('silent1.png')
  await page.click('[data-testid="filter-active"]')
  await page.waitForTimeout(400)
  const s2 = await shot('silent2.png')
  await page.click('[data-testid="page-2"]')
  await page.waitForTimeout(400)
  const s3 = await shot('silent3.png')
  slideshow(
    [
      { file: s1, seconds: 3 },
      { file: s2, seconds: 4 },
      { file: s3, seconds: 5 }
    ],
    join(OUT, 'silent-demo.mp4'),
    silentWav('silent-demo.wav', 12)
  )

  // Negative control: same catalog flow, defect off, no speech.
  await page.goto(`${BASE}/demo?defect=off`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="filter-active"]')
  const h1 = await shot('healthy1.png')
  await page.click('[data-testid="filter-active"]')
  await page.waitForTimeout(400)
  const h2 = await shot('healthy2.png')
  await page.click('[data-testid="page-2"]')
  await page.waitForTimeout(400)
  const h3 = await shot('healthy3.png')
  slideshow(
    [
      { file: h1, seconds: 3 },
      { file: h2, seconds: 4 },
      { file: h3, seconds: 5 }
    ],
    join(OUT, 'healthy-demo.mp4'),
    silentWav('healthy-demo.wav', 12)
  )

  // Unrelated buggy app: form value disappears after a different control is used.
  await page.goto(`${BASE}/notes`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="requester-name"]')
  await page.fill('[data-testid="requester-name"]', 'Sam Rivera')
  await page.fill('[data-testid="request-details"]', 'Need a monitor arm')
  const fb1 = await shot('form-bug-1.png')
  await page.click('[data-testid="urgency-urgent"]')
  await page.waitForTimeout(600)
  const fb2 = await shot('form-bug-2.png')
  slideshow(
    [
      { file: fb1, seconds: 4 },
      { file: fb2, seconds: 6 }
    ],
    join(OUT, 'form-bug.mp4'),
    silentWav('form-bug.wav', 10)
  )

  // Unrelated healthy app: same form, name remains after urgency change.
  await page.goto(`${BASE}/notes?defect=off`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="requester-name"]')
  await page.fill('[data-testid="requester-name"]', 'Sam Rivera')
  await page.fill('[data-testid="request-details"]', 'Need a monitor arm')
  const fo1 = await shot('form-ok-1.png')
  await page.click('[data-testid="urgency-urgent"]')
  await page.waitForTimeout(600)
  const fo2 = await shot('form-ok-2.png')
  slideshow(
    [
      { file: fo1, seconds: 4 },
      { file: fo2, seconds: 6 }
    ],
    join(OUT, 'form-ok.mp4'),
    silentWav('form-ok.wav', 10)
  )

  await browser.close()
  if (!existsSync(join(OUT, 'test-a.mp4'))) throw new Error('test-a.mp4 was not created')
  console.log(
    'Wrote test-a.mp4, test-b.mp4, test-c.mp4, new-input.mp4, silent-demo.mp4, healthy-demo.mp4, form-bug.mp4, form-ok.mp4'
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
