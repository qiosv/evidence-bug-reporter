import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = [
  join(ROOT, 'src/renderer'),
  join(ROOT, 'src/shared/credentialHeaders.ts'),
  join(ROOT, 'server/requestCredentials.ts'),
  join(ROOT, 'server/app.ts')
]

const STORAGE = /localStorage|sessionStorage|indexedDB|document\.cookie/i
const KEY_HINT = /apiKey|api_key|xaiApiKey|geminiApiKey|credential/i

function walk(path: string): string[] {
  const st = statSync(path)
  if (st.isFile()) return [path]
  const out: string[] = []
  for (const entry of readdirSync(path)) {
    const full = join(path, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx|js|mjs)$/i.test(entry)) out.push(full)
  }
  return out
}

function main(): void {
  const hits: string[] = []
  for (const target of TARGETS) {
    for (const file of walk(target)) {
      const text = readFileSync(file, 'utf8')
      if (STORAGE.test(text) && KEY_HINT.test(text)) {
        hits.push(file.replace(ROOT, '.'))
      }
    }
  }
  if (hits.length > 0) {
    console.error('Credential persistence scan FAILED')
    for (const hit of hits) console.error(`storage API near credential code in ${hit}`)
    process.exit(1)
  }
  console.log('No credential persistence APIs found in BYOK session/request code.')
}

main()
