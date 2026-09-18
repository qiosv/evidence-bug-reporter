import { useEffect, useRef, useState, type JSX } from 'react'
import { uid } from '../../../shared/id'
import { LIVE_CHANGE_THRESHOLD, pixelDiffRatio } from '../../../live/changeDetection'
import { describeCaptureError, requireCaptureSupport } from '../../../live/captureErrors'
import {
  createSessionMemory,
  rememberSpeaker,
  rememberVisibleChange,
  type SessionMemory
} from '../../../live/sessionMemory'
import { EvidenceLabel } from '../components/EvidenceLabel'
import { sessionAuthHeaders } from '../lib/sessionCredentials'
import type { EvidenceEvent } from '../../../shared/types'

const SAMPLE_MS = 1500
const MIC_CHUNK_MS = 4000

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function LivePage(): JSX.Element {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<string | null>(null)
  const [events, setEvents] = useState<EvidenceEvent[]>([])
  const [memory, setMemory] = useState<SessionMemory>(() => createSessionMemory(0))
  const [elapsedMs, setElapsedMs] = useState(0)
  const [micState, setMicState] = useState<'idle' | 'live' | 'denied'>('idle')
  const [screenState, setScreenState] = useState<'idle' | 'live' | 'denied'>('idle')
  const [sttPending, setSttPending] = useState(0)
  const displayRef = useRef<MediaStream | null>(null)
  const micRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const clockRef = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const prevRef = useRef<ImageData | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const startedAtRef = useRef(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const memoryRef = useRef<SessionMemory>(memory)
  const transcribeQueue = useRef(Promise.resolve())

  const nowOffset = (): number => Date.now() - startedAtRef.current

  const stop = (): void => {
    setRunning(false)
    setMicState((s) => (s === 'live' ? 'idle' : s))
    setScreenState((s) => (s === 'live' ? 'idle' : s))
    if (timerRef.current) window.clearInterval(timerRef.current)
    if (clockRef.current) window.clearInterval(clockRef.current)
    timerRef.current = null
    clockRef.current = null
    try {
      recorderRef.current?.stop()
    } catch {
      // already stopped
    }
    recorderRef.current = null
    displayRef.current?.getTracks().forEach((t) => t.stop())
    micRef.current?.getTracks().forEach((t) => t.stop())
    displayRef.current = null
    micRef.current = null
  }

  useEffect(() => {
    return () => stop()
  }, [])

  const pushMemory = (next: SessionMemory): void => {
    memoryRef.current = next
    setMemory(next)
  }

  const start = async (): Promise<void> => {
    setError(null)
    setErrorKind(null)
    const support = requireCaptureSupport()
    if (support) {
      setError(support.message)
      setErrorKind(support.kind)
      return
    }

    let display: MediaStream | null = null
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 8 },
        audio: false
      })
    } catch (err) {
      const feedback = describeCaptureError('screen', err)
      setError(feedback.message)
      setErrorKind(feedback.kind)
      setScreenState(feedback.kind === 'screen_denied' || feedback.kind === 'screen_cancelled' ? 'denied' : 'idle')
      return
    }

    let mic: MediaStream
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      display.getTracks().forEach((t) => t.stop())
      const feedback = describeCaptureError('microphone', err)
      setError(feedback.message)
      setErrorKind(feedback.kind)
      setMicState('denied')
      setScreenState('idle')
      return
    }

    displayRef.current = display
    micRef.current = mic
    // Session clock starts when the user clicks Start, not during render.
    // eslint-disable-next-line react-hooks/purity -- event handler, not render
    startedAtRef.current = Date.now()
    prevRef.current = null
    const session = createSessionMemory(startedAtRef.current)
    memoryRef.current = session
    setMemory(session)
    setEvents([])
    setElapsedMs(0)
    setRunning(true)
    setScreenState('live')
    setMicState('live')
    attachPreview(display)
    display.getVideoTracks()[0]?.addEventListener('ended', () => {
      stop()
    })
    sampleLoop()
    chunkMic(mic)
    clockRef.current = window.setInterval(() => setElapsedMs(nowOffset()), 250)
  }

  const attachPreview = (stream: MediaStream): void => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    void video.play().catch(() => undefined)
  }

  const sampleLoop = (): void => {
    const canvas = canvasRef.current ?? document.createElement('canvas')
    canvasRef.current = canvas
    canvas.width = 96
    canvas.height = 54
    timerRef.current = window.setInterval(() => {
      const video = videoRef.current
      if (!video || video.readyState < 2) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
      if (prevRef.current && pixelDiffRatio(prevRef.current, frame) < LIVE_CHANGE_THRESHOLD) return
      prevRef.current = frame
      const ts = nowOffset()
      const description = 'Visible screen change (local sample; unchanged frames skipped).'
      const id = uid()
      pushMemory(rememberVisibleChange(memoryRef.current, { id, timestampMs: ts, description }))
      setEvents((prev) => [
        ...prev,
        {
          id,
          timestampMs: ts,
          type: 'change',
          source: 'visible',
          description,
          frameTimestampMs: ts
        }
      ])
    }, SAMPLE_MS)
  }

  const transcribeChunk = (blob: Blob): void => {
    transcribeQueue.current = transcribeQueue.current.then(async () => {
      const ts = nowOffset()
      setSttPending((n) => n + 1)
      try {
        const body = new FormData()
        body.append('audio', blob, `chunk.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`)
        body.append('offsetMs', String(ts))
        const res = await fetch('/api/live/transcribe', {
          method: 'POST',
          body,
          headers: sessionAuthHeaders()
        })
        const json = (await res.json()) as { ok?: boolean; text?: string; error?: string; latencyMs?: number }
        if (!res.ok || !json.ok) {
          setError(json.error || 'Live transcription request failed.')
          setErrorKind('stt')
          return
        }
        const text = (json.text ?? '').trim()
        if (!text) return
        const id = uid()
        pushMemory(rememberSpeaker(memoryRef.current, { id, timestampMs: ts, text }))
        setEvents((prev) => [
          ...prev,
          {
            id,
            timestampMs: ts,
            type: 'speaker_statement',
            source: 'speaker_claim',
            description: text,
            metadata: { sttLatencyMs: json.latencyMs }
          }
        ])
      } catch {
        setError('Network error while sending a microphone chunk for transcription.')
        setErrorKind('stt')
      } finally {
        setSttPending((n) => Math.max(0, n - 1))
      }
    })
  }

  const chunkMic = (stream: MediaStream): void => {
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4'
    const rec = new MediaRecorder(stream, { mimeType: mime })
    rec.ondataavailable = (e) => {
      if (!e.data.size || e.data.size < 1500) return
      transcribeChunk(e.data)
    }
    rec.start(MIC_CHUNK_MS)
    recorderRef.current = rec
  }

  return (
    <div className="live">
      <h2>Live analysis beta</h2>
      <p className="muted">
        You choose the screen/window/tab and the microphone. Frames are sampled locally every 1.5s;
        near-identical frames are skipped and are not sent to Gemini. Speech uses short microphone
        chunks through the same xAI STT path as recordings. This is not a hidden capture, and it is
        not a full realtime socket.
      </p>
      <div className="live-status">
        <span>
          Analysis: <strong>{running ? 'recording' : 'idle'}</strong>
        </span>
        <span>
          Screen: <strong>{screenState}</strong>
        </span>
        <span>
          Microphone: <strong>{micState}</strong>
        </span>
        <span>
          Duration: <strong>{formatDuration(elapsedMs)}</strong>
        </span>
        <span>
          STT in flight: <strong>{sttPending}</strong>
        </span>
      </div>
      <div className="controls">
        {!running ? (
          <button type="button" className="btn-primary" onClick={() => void start()}>
            Start live analysis
          </button>
        ) : (
          <button type="button" className="btn-primary stop" onClick={stop}>
            Stop Live Analysis
          </button>
        )}
      </div>
      {error && (
        <div className="banner">
          <p>{error}</p>
          {errorKind && <p className="muted">Cause: {errorKind.replace(/_/g, ' ')}</p>}
          <button type="button" className="btn-primary" onClick={() => void start()}>
            Retry
          </button>
        </div>
      )}
      <div className="live-grid">
        <div>
          <video ref={videoRef} autoPlay muted playsInline className="player" />
        </div>
        <div>
          <h3>Detected issues</h3>
          {memory.issues.length === 0 ? (
            <p className="muted">No issue candidates yet. Claims are never treated as visible proof.</p>
          ) : (
            <ul className="timeline">
              {memory.issues.map((issue, i) => (
                <li key={`${issue.timestampMs}-${i}`} className={`ev-row ${issue.source}`}>
                  <EvidenceLabel source={issue.source} timestampMs={issue.timestampMs} />
                  {issue.text}
                  {issue.verificationState !== 'none' && (
                    <p className="muted">{issue.verificationState.replace(/_/g, ' ')}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <h3>Session memory</h3>
      <ul className="timeline">
        {memory.entries.map((entry) => (
          <li key={entry.id} className={`ev-row ${entry.source}`}>
            <EvidenceLabel source={entry.source} timestampMs={entry.timestampMs} />
            {entry.visibleState ?? entry.speakerStatement}
            {entry.changeId && <p className="muted">{entry.changeId}</p>}
            {entry.detectedIssue && <p>{entry.detectedIssue}</p>}
          </li>
        ))}
      </ul>
      <h3>Timeline</h3>
      <ul className="timeline">
        {events.map((e) => (
          <li key={e.id} className={`ev-row ${e.source}`}>
            <EvidenceLabel source={e.source} timestampMs={e.timestampMs} />
            {e.description}
          </li>
        ))}
      </ul>
    </div>
  )
}
