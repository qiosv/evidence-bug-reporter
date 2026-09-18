import { useEffect, useState, type JSX } from 'react'
import {
  clearSessionCredentials,
  getSessionCredentials,
  sessionAuthHeaders,
  setSessionCredentials,
  subscribeSessionCredentials
} from '../lib/sessionCredentials'

type FieldStatus = 'not_configured' | 'checking' | 'connected' | 'invalid'
type ApiKeyMode = 'byok' | 'server'

function visibleStatus(hasKey: boolean, status: FieldStatus): FieldStatus {
  if (status === 'checking') return status
  if (!hasKey) return 'not_configured'
  return status
}

function statusLabel(status: FieldStatus): string {
  if (status === 'not_configured') return 'Not configured'
  if (status === 'checking') return 'Checking'
  if (status === 'connected') return 'Connected'
  return 'Invalid'
}

export function ApiConfig(): JSX.Element {
  const [mode, setMode] = useState<ApiKeyMode | null>(null)
  const creds = useSession()
  const [xaiDraft, setXaiDraft] = useState('')
  const [geminiDraft, setGeminiDraft] = useState('')
  const [showXai, setShowXai] = useState(false)
  const [showGemini, setShowGemini] = useState(false)
  const [xaiStatus, setXaiStatus] = useState<FieldStatus>('not_configured')
  const [geminiStatus, setGeminiStatus] = useState<FieldStatus>('not_configured')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/api/health')
      .then((r) => r.json())
      .then((data: { apiKeyMode?: string }) => {
        setMode(data.apiKeyMode === 'server' ? 'server' : 'byok')
      })
      .catch(() => setMode('byok'))
  }, [])

  const xaiShown = visibleStatus(Boolean(creds.xaiApiKey), xaiStatus)
  const geminiShown = visibleStatus(Boolean(creds.geminiApiKey), geminiStatus)

  const onXaiChange = (value: string): void => {
    setXaiDraft(value)
    setSessionCredentials({ xaiApiKey: value })
    setXaiStatus('not_configured')
  }

  const onGeminiChange = (value: string): void => {
    setGeminiDraft(value)
    setSessionCredentials({ geminiApiKey: value })
    setGeminiStatus('not_configured')
  }

  const testConnection = async (): Promise<void> => {
    setMessage(null)
    setXaiStatus('checking')
    setGeminiStatus('checking')
    try {
      const res = await fetch('/api/providers/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...sessionAuthHeaders()
        },
        body: '{}'
      })
      const data = (await res.json()) as {
        error?: string
        xai?: string
        gemini?: string
        xaiError?: string
        geminiError?: string
      }
      if (!res.ok) {
        setXaiStatus('invalid')
        setGeminiStatus('invalid')
        setMessage(data.error || 'Configure your API keys to test the connection.')
        return
      }
      setXaiStatus(data.xai === 'connected' ? 'connected' : 'invalid')
      setGeminiStatus(data.gemini === 'connected' ? 'connected' : 'invalid')
      const parts = [data.xaiError, data.geminiError].filter(Boolean)
      setMessage(parts.length ? parts.join(' ') : null)
    } catch {
      setXaiStatus('invalid')
      setGeminiStatus('invalid')
      setMessage('Could not reach the analysis server to test keys.')
    }
  }

  const clearKeys = (): void => {
    setXaiDraft('')
    setGeminiDraft('')
    setShowXai(false)
    setShowGemini(false)
    clearSessionCredentials()
    setXaiStatus('not_configured')
    setGeminiStatus('not_configured')
    setMessage('Keys cleared from this browser session.')
  }

  if (mode === null) {
    return (
      <section className="api-config">
        <h2>API Configuration</h2>
        <p className="muted">Checking credential mode…</p>
      </section>
    )
  }

  if (mode === 'server') {
    return (
      <section className="api-config">
        <h2>API Configuration</h2>
        <p>
          This instance uses server-side API keys for local/developer-controlled processing. You do
          not need to enter credentials.
        </p>
        <div className="api-config-actions">
          <button type="button" onClick={() => void testConnection()}>
            Test connection
          </button>
          <span className={`key-status ${xaiStatus}`}>xAI: {statusLabel(xaiStatus)}</span>
          <span className={`key-status ${geminiStatus}`}>Gemini: {statusLabel(geminiStatus)}</span>
        </div>
        {message && <p className="muted">{message}</p>}
      </section>
    )
  }

  return (
    <section className="api-config">
      <h2>API Configuration</h2>
      <p>
        Bring your own xAI and Gemini keys. They are used only to process your recordings and are
        not stored permanently. Keys are kept only for this browser session and are cleared on
        refresh/close.
      </p>
      <div className="api-fields">
        <KeyField
          label="xAI API Key"
          value={xaiDraft}
          show={showXai}
          status={xaiShown}
          entered={Boolean(creds.xaiApiKey)}
          onChange={onXaiChange}
          onToggle={() => setShowXai((v) => !v)}
        />
        <KeyField
          label="Gemini API Key"
          value={geminiDraft}
          show={showGemini}
          status={geminiShown}
          entered={Boolean(creds.geminiApiKey)}
          onChange={onGeminiChange}
          onToggle={() => setShowGemini((v) => !v)}
        />
      </div>
      <div className="api-config-actions">
        <button type="button" onClick={() => void testConnection()}>
          Test connection
        </button>
        <button type="button" onClick={clearKeys}>
          Clear keys
        </button>
      </div>
      {message && <p className="muted">{message}</p>}
    </section>
  )
}

function useSession(): { xaiApiKey: string; geminiApiKey: string } {
  const [creds, setCreds] = useState(getSessionCredentials)
  useEffect(() => subscribeSessionCredentials(() => setCreds(getSessionCredentials())), [])
  return creds
}

function KeyField(props: {
  label: string
  value: string
  show: boolean
  status: FieldStatus
  entered: boolean
  onChange: (value: string) => void
  onToggle: () => void
}): JSX.Element {
  return (
    <label className="api-field">
      <span>
        {props.label}
        <span className={`key-status ${props.status}`}>{statusLabel(props.status)}</span>
      </span>
      <div className="api-field-row">
        <input
          type={props.show ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          value={props.value}
          placeholder={props.entered ? 'Key entered for this session' : ''}
          onChange={(e) => props.onChange(e.target.value)}
        />
        <button type="button" className="btn-quiet" onClick={props.onToggle}>
          {props.show ? 'Hide' : 'Show'}
        </button>
      </div>
    </label>
  )
}
