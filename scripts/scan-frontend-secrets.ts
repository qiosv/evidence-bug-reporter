import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist/client')

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'GROQ_API_KEY', re: /GROQ_API_KEY/ },
  { name: 'GEMINI_API_KEY', re: /GEMINI_API_KEY/ },
  { name: 'XAI_API_KEY', re: /XAI_API_KEY/ },
  { name: 'gsk_ prefix', re: /gsk_[A-Za-z0-9]/ },
  { name: 'AIza prefix', re: /AIza[A-Za-z0-9]/ },
  { name: 'xai- prefix', re: /\bxai-[A-Za-z0-9_-]{8,}/ }
]

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(js|css|html|map|json)$/i.test(entry)) out.push(full)
  }
  return out
}

function main(): void {
  const files = walk(DIST)
  const hits: string[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const p of PATTERNS) {
      if (p.re.test(text)) hits.push(`${p.name} in ${file.replace(ROOT, '.')}`)
    }
  }
  if (hits.length > 0) {
    console.error('Frontend credential scan FAILED')
    for (const hit of hits) console.error(`potential credential found in ${hit}`)
    process.exit(1)
  }
  console.log('No API credentials detected in frontend build.')
}

main()
