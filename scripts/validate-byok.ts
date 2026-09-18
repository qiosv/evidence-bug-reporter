import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireEnv } from '../server/env'
import { createApp } from '../server/app'
import { USER_GEMINI_KEY_HEADER, USER_XAI_KEY_HEADER } from '../src/shared/credentialHeaders'
import type { AppEnv } from '../server/requestCredentials'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIX = join(ROOT, 'tests/fixtures/form-ok.mp4')

function listen(app: ReturnType<typeof createApp>): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(app)
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('could not bind test server'))
        return
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()))
          })
      })
    })
  })
}

async function readSseStatus(res: Response): Promise<{ error?: string; status?: string }> {
  const text = await res.text()
  if (!res.ok) {
    try {
      const json = JSON.parse(text) as { error?: string }
      return { error: json.error }
    } catch {
      return { error: text.slice(0, 200) }
    }
  }
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = JSON.parse(line.slice(5).trim()) as {
      type?: string
      error?: string
      data?: { report?: { status?: string } }
    }
    if (payload.type === 'error') return { error: payload.error }
    if (payload.type === 'result') return { status: payload.data?.report?.status }
  }
  return { error: 'no SSE result' }
}

async function main(): Promise<void> {
  const real = requireEnv()
  if (!real.xaiApiKey || !real.geminiApiKey) {
    console.error('Real BYOK analysis skipped: local .env keys are missing.')
    process.exit(2)
  }

  const byokEnv: AppEnv = {
    ...real,
    apiKeyMode: 'byok',
    xaiApiKey: 'server-must-not-be-used-xai',
    geminiApiKey: 'server-must-not-be-used-gemini',
    groqApiKey: ''
  }

  const app = createApp(byokEnv)
  const { url, close } = await listen(app)
  try {
    const healthRes = await fetch(`${url}/api/health`)
    const health = (await healthRes.json()) as { apiKeyMode?: string; xai?: string }
    if (health.apiKeyMode !== 'byok') throw new Error(`expected byok health, got ${health.apiKeyMode}`)
    if (health.xai !== 'user') throw new Error('BYOK health must not advertise server keys')

    const bytes = readFileSync(FIX)
    const noHeaderForm = new FormData()
    noHeaderForm.append('video', new File([bytes], 'form-ok.mp4', { type: 'video/mp4' }))
    const denied = await fetch(`${url}/api/analyze`, { method: 'POST', body: noHeaderForm })
    const deniedBody = await denied.text()
    if (denied.status === 200 && /"type":"result"/.test(deniedBody)) {
      throw new Error('BYOK analysis succeeded without user keys — server fallback detected')
    }
    if (!/required|API key/i.test(deniedBody)) {
      throw new Error(`expected BYOK missing-key error, got HTTP ${denied.status}`)
    }
    console.log('BYOK without headers: rejected (server keys not used)')

    const ping = await fetch(`${url}/api/providers/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [USER_XAI_KEY_HEADER]: real.xaiApiKey,
        [USER_GEMINI_KEY_HEADER]: real.geminiApiKey
      },
      body: '{}'
    })
    const pingJson = (await ping.json()) as { xai?: string; gemini?: string; error?: string }
    if (pingJson.xai !== 'connected' || pingJson.gemini !== 'connected') {
      throw new Error(`connection test failed xai=${pingJson.xai} gemini=${pingJson.gemini}`)
    }
    console.log('xAI connection test: connected')
    console.log('Gemini connection test: connected')

    const form = new FormData()
    form.append('video', new File([bytes], 'form-ok.mp4', { type: 'video/mp4' }))
    const ok = await fetch(`${url}/api/analyze`, {
      method: 'POST',
      body: form,
      headers: {
        [USER_XAI_KEY_HEADER]: real.xaiApiKey,
        [USER_GEMINI_KEY_HEADER]: real.geminiApiKey
      }
    })
    const result = await readSseStatus(ok)
    if (result.error) throw new Error(`BYOK analysis failed: ${result.error}`)
    if (!result.status) throw new Error('BYOK analysis returned no status')
    console.log(`BYOK analysis used request headers only. report_status=${result.status}`)
    console.log('BYOK xAI = user header credential; BYOK Gemini = user header credential; server env credentials unused')
  } finally {
    await close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
