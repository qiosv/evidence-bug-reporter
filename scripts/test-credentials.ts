import { createHash } from 'node:crypto'
import { USER_GEMINI_KEY_HEADER, USER_XAI_KEY_HEADER } from '../src/shared/credentialHeaders'
import type { AppEnv } from '../server/requestCredentials'
import { CredentialsError, resolveRequestCredentials, scopedProviderEnv } from '../server/requestCredentials'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

const serverEnv: AppEnv = {
  groqApiKey: 'server-groq-must-not-leak',
  geminiApiKey: 'server-gemini-must-not-be-used',
  xaiApiKey: 'server-xai-must-not-be-used',
  groqBaseUrl: 'https://example.invalid/groq',
  groqModel: 'whisper',
  geminiBaseUrl: 'https://example.invalid/gemini',
  geminiModel: 'gemini-3.5-flash-lite',
  xaiBaseUrl: 'https://example.invalid/xai',
  xaiSttModel: 'xai-stt',
  transcriptionProvider: 'xai',
  apiKeyMode: 'byok',
  port: 8787,
  envSource: '.env'
}

const keyA = {
  xai: 'user-a-xai-credential-11111111',
  gemini: 'user-a-gemini-credential-aaaa'
}
const keyB = {
  xai: 'user-b-xai-credential-22222222',
  gemini: 'user-b-gemini-credential-bbbb'
}

const headersA = {
  [USER_XAI_KEY_HEADER.toLowerCase()]: keyA.xai,
  [USER_GEMINI_KEY_HEADER.toLowerCase()]: keyA.gemini
}
const headersB = {
  [USER_XAI_KEY_HEADER.toLowerCase()]: keyB.xai,
  [USER_GEMINI_KEY_HEADER.toLowerCase()]: keyB.gemini
}

try {
  resolveRequestCredentials({}, serverEnv)
  throw new Error('BYOK missing headers should fail')
} catch (err) {
  if (!(err instanceof CredentialsError)) throw err
  assert(/required/i.test(err.message), 'missing BYOK message')
}

const a = resolveRequestCredentials(headersA, serverEnv)
const b = resolveRequestCredentials(headersB, serverEnv)
assert(a.source === 'byok' && b.source === 'byok', 'BYOK source')
assert(a.xaiApiKey === keyA.xai && a.geminiApiKey === keyA.gemini, 'request A uses credential set A')
assert(b.xaiApiKey === keyB.xai && b.geminiApiKey === keyB.gemini, 'request B uses credential set B')
assert(a.xaiApiKey !== serverEnv.xaiApiKey && a.geminiApiKey !== serverEnv.geminiApiKey, 'A must not use server keys')
assert(b.xaiApiKey !== a.xaiApiKey && b.geminiApiKey !== a.geminiApiKey, 'A and B stay isolated')
assert(a.groqApiKey === '', 'BYOK does not attach server Groq key')

const serverMode: AppEnv = { ...serverEnv, apiKeyMode: 'server' }
const mixed = resolveRequestCredentials(headersA, serverMode)
assert(mixed.source === 'server', 'server mode source')
assert(mixed.xaiApiKey === serverEnv.xaiApiKey, 'server mode ignores user xAI header')
assert(mixed.geminiApiKey === serverEnv.geminiApiKey, 'server mode ignores user Gemini header')

const scopedA = scopedProviderEnv(serverEnv, a)
const scopedB = scopedProviderEnv(serverEnv, b)
assert(scopedA !== serverEnv, 'scoped env is a copy')
assert(scopedA.xaiApiKey === keyA.xai, 'scoped A xAI')
assert(scopedB.xaiApiKey === keyB.xai, 'scoped B xAI')
assert(serverEnv.xaiApiKey === 'server-xai-must-not-be-used', 'shared env is unchanged')
assert(process.env.XAI_API_KEY !== keyA.xai && process.env.XAI_API_KEY !== keyB.xai, 'process.env was not mutated with user keys')

const concurrent = await Promise.all([
  Promise.resolve(scopedProviderEnv(serverEnv, resolveRequestCredentials(headersA, serverEnv))),
  Promise.resolve(scopedProviderEnv(serverEnv, resolveRequestCredentials(headersB, serverEnv)))
])
assert(
  fingerprint(concurrent[0].xaiApiKey) === fingerprint(keyA.xai) &&
    fingerprint(concurrent[1].xaiApiKey) === fingerprint(keyB.xai),
  'concurrent requests keep distinct credentials'
)
assert(concurrent[0].geminiApiKey !== concurrent[1].geminiApiKey, 'concurrent Gemini keys differ')
assert(
  concurrent[0].xaiApiKey !== serverEnv.xaiApiKey && concurrent[1].xaiApiKey !== serverEnv.xaiApiKey,
  'concurrent BYOK never falls back to server keys'
)

console.log('credential isolation checks passed (BYOK vs SERVER, concurrent A/B, no process.env mutation)')
