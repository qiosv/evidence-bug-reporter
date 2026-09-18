import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TMP = join(ROOT, 'tmp')
mkdirSync(TMP, { recursive: true })
mkdirSync(join(ROOT, 'tests/results'), { recursive: true })

const API = process.env.API_URL ?? 'http://localhost:8787'

async function postFile(name: string, bytes: Buffer, mime: string): Promise<{ status: number; body: string }> {
  const form = new FormData()
  form.append('video', new File([bytes], name, { type: mime }))
  const res = await fetch(`${API}/api/analyze`, { method: 'POST', body: form })
  return { status: res.status, body: await res.text() }
}

function sseError(body: string): string {
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('data:'))
  for (const line of lines) {
    try {
      const json = JSON.parse(line.slice(5).trim()) as { type?: string; error?: string }
      if (json.error) return json.error
    } catch {
      // keep looking
    }
  }
  return body.slice(0, 300)
}

async function main(): Promise<void> {
  const cases: Array<{ name: string; ok: boolean; detail: string }> = []

  const txt = await postFile('notes.txt', Buffer.from('not a video'), 'text/plain')
  cases.push({
    name: 'non-mp4',
    ok: txt.status === 400 && /mp4|unsupported/i.test(txt.body),
    detail: `${txt.status} ${txt.body.slice(0, 160)}`
  })

  const long = join(TMP, 'long.mp4')
  spawnSync(
    'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=91', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', long],
    { windowsHide: true }
  )
  const longBuf = await import('node:fs/promises').then((fs) => fs.readFile(long))
  const longRes = await postFile('long.mp4', longBuf, 'video/mp4')
  const longErr = sseError(longRes.body)
  cases.push({
    name: 'mp4-over-90s',
    ok: /90 second/i.test(longErr) || /90 seconds/i.test(longErr),
    detail: longErr
  })

  const corrupt = await postFile('bad.mp4', Buffer.from('ftypmp42notreally'), 'video/mp4')
  const corruptErr = sseError(corrupt.body)
  cases.push({
    name: 'corrupt-video',
    ok: /metadata|could not read|empty|unsupported/i.test(corruptErr),
    detail: corruptErr
  })

  const health = (await fetch(`${API}/api/health`).then((r) => r.json())) as {
    apiKeyMode?: string
    xai?: string
    groq?: string
    gemini?: string
    transcriptionProvider?: string
  }
  const fixture = join(ROOT, 'tests/fixtures/test-a.mp4')
  const fixtureBuf = await import('node:fs/promises').then((fs) => fs.readFile(fixture))
  if (health.apiKeyMode === 'byok') {
    const missing = await postFile('test-a.mp4', fixtureBuf, 'video/mp4')
    const missingErr = `${missing.status} ${missing.body}`
    cases.push({
      name: 'provider-keys-missing',
      ok: missing.status === 401 && /API key|required/i.test(missingErr),
      detail: missingErr.slice(0, 200)
    })
  } else {
    const sttMissing =
      health.transcriptionProvider === 'groq' ? health.groq === 'missing' : health.xai === 'missing'
    if (sttMissing || health.gemini === 'missing') {
      const missing = await postFile('test-a.mp4', fixtureBuf, 'video/mp4')
      const missingErr = sseError(missing.body)
      cases.push({
        name: 'provider-keys-missing',
        ok: /not configured|Transcription provider|Video analysis provider|API key/i.test(missingErr),
        detail: missingErr
      })
    } else {
      cases.push({
        name: 'provider-keys-missing',
        ok: true,
        detail: 'skipped — active STT and Gemini are configured'
      })
    }
  }

  for (const c of cases) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`)
  }
  writeFileSync(join(ROOT, 'tests/results/error-cases.json'), JSON.stringify(cases, null, 2))
  if (cases.some((c) => !c.ok)) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
