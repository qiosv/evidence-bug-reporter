import { USER_GEMINI_KEY_HEADER, USER_XAI_KEY_HEADER } from '../../../shared/credentialHeaders'

type Listener = () => void

let xaiApiKey = ''
let geminiApiKey = ''
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function getSessionCredentials(): { xaiApiKey: string; geminiApiKey: string } {
  return { xaiApiKey, geminiApiKey }
}

export function hasSessionCredentials(): boolean {
  return Boolean(xaiApiKey && geminiApiKey)
}

export function setSessionCredentials(next: { xaiApiKey?: string; geminiApiKey?: string }): void {
  if (next.xaiApiKey !== undefined) xaiApiKey = next.xaiApiKey.trim()
  if (next.geminiApiKey !== undefined) geminiApiKey = next.geminiApiKey.trim()
  emit()
}

export function clearSessionCredentials(): void {
  xaiApiKey = ''
  geminiApiKey = ''
  emit()
}

export function sessionAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  if (xaiApiKey) headers[USER_XAI_KEY_HEADER] = xaiApiKey
  if (geminiApiKey) headers[USER_GEMINI_KEY_HEADER] = geminiApiKey
  return headers
}

export function subscribeSessionCredentials(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
