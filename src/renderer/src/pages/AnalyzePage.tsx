import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { ReportView } from '../components/ReportView'
import { ApiConfig } from '../components/ApiConfig'
import { seekToEvidence } from '../lib/frameCapture'
import { assertByokReady, postAnalyze } from '../lib/analyzeClient'
import type { AnalyzeSuccess, WorkflowPhase } from '../../../shared/types'

const PHASE_LABEL: Record<WorkflowPhase, string> = {
  idle: 'Idle',
  validating: 'Validating MP4…',
  transcribing: 'Transcribing speech…',
  analyzing_video: 'Analyzing visible UI…',
  generating_report: 'Building evidence report…',
  ready: 'Ready',
  error: 'Error'
}

interface Props {
  onResult?: (result: AnalyzeSuccess) => void
}

export function AnalyzePage({ onResult }: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const busyRef = useRef(false)
  const [player, setPlayer] = useState<HTMLVideoElement | null>(null)
  const [providers, setProviders] = useState<{
    mode: 'byok' | 'server' | null
    transcriptionProvider?: string
  }>({ mode: null })
  const [phase, setPhase] = useState<WorkflowPhase>('idle')
  const [progress, setProgress] = useState('Drop an MP4 (max 90 seconds).')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalyzeSuccess | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [reportKey, setReportKey] = useState(0)

  const revokeUrl = (): void => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }

  const resetForAnotherVideo = useCallback((): void => {
    if (busyRef.current) return
    revokeUrl()
    if (inputRef.current) inputRef.current.value = ''
    setPlayer(null)
    setVideoUrl(null)
    setResult(null)
    setError(null)
    setFileName(null)
    setPhase('idle')
    setProgress('Drop an MP4 (max 90 seconds).')
    setReportKey((key) => key + 1)
  }, [])

  useEffect(() => () => revokeUrl(), [])

  useEffect(() => {
    void fetch('/api/health')
      .then((r) => r.json())
      .then((data: { apiKeyMode?: string; transcriptionProvider?: string }) => {
        setProviders({
          mode: data.apiKeyMode === 'server' ? 'server' : 'byok',
          transcriptionProvider: data.transcriptionProvider
        })
      })
      .catch(() => setProviders({ mode: 'byok' }))
  }, [])

  const runFile = useCallback(async (file: File) => {
    if (busyRef.current) return
    busyRef.current = true
    setError(null)
    setResult(null)
    setPhase('validating')
    setProgress('Checking file in the browser…')
    setFileName(file.name)

    try {
      if (!file.name.toLowerCase().endsWith('.mp4') && file.type !== 'video/mp4') {
        setPhase('error')
        setError('Unsupported file format. Upload an MP4 recording.')
        return
      }

      revokeUrl()
      const url = URL.createObjectURL(file)
      objectUrlRef.current = url
      setVideoUrl(url)

      try {
        const duration = await readDuration(url)
        if (duration < 0.4) {
          throw new Error('Empty or too-short video. The recording has no usable duration.')
        }
        if (duration > 90.25) {
          throw new Error(`Video is longer than 90 seconds (${duration.toFixed(1)}s). Trim the recording and retry.`)
        }
      } catch (err) {
        setPhase('error')
        setError(err instanceof Error ? err.message : String(err))
        return
      }

      try {
        assertByokReady(providers.mode)
        const data = await postAnalyze(file, (nextPhase, message) => {
          setPhase(nextPhase)
          setProgress(message)
        })
        setResult(data)
        setReportKey((key) => key + 1)
        setPhase('ready')
        setProgress('Report ready.')
        onResult?.(data)
      } catch (err) {
        setPhase('error')
        const message = err instanceof Error ? err.message : String(err)
        if (/Failed to fetch|NetworkError/i.test(message)) {
          setError('Network error while contacting the analysis server. Is the API running?')
        } else {
          setError(message)
        }
      }
    } finally {
      busyRef.current = false
    }
  }, [onResult, providers.mode])

  const onSeek = async (timestampMs: number): Promise<void> => {
    const video = videoRef.current
    if (!video) return
    try {
      await seekToEvidence(video, timestampMs)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="workspace">
      <div className="workspace-left">
        {!result && (
          <div className="upload-card">
            <h2>Analyze recording</h2>
            <p>
              Upload an MP4 screen recording (max 90 seconds, one speaker). Spoken commentary is
              optional. The report separates <strong>VISIBLE</strong> UI from{' '}
              <strong>CLAIMED</strong> speech and <strong>UNKNOWN</strong> facts.
            </p>
            <ApiConfig />
            <p>
              Need a defect to record? Open the{' '}
              <a href="/demo" target="_blank" rel="noreferrer">
                product listing demo
              </a>
              . Status filter resets after Page 2.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,.mp4"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void runFile(file)
              }}
            />
            <button type="button" className="btn-primary" onClick={() => inputRef.current?.click()}>
              Choose MP4
            </button>
            {fileName && <p className="muted">Selected: {fileName}</p>}
            <p className="privacy">
              Uploaded recordings are processed for analysis. Temporary files are deleted after the
              request completes. Recordings are not stored on the server. API credentials are used
              for the current processing session only and are not stored by this application.
              Recordings are processed by the configured AI providers.
            </p>
          </div>
        )}

        {phase !== 'idle' && phase !== 'ready' && phase !== 'error' && (
          <div className="progress-card">
            <div className="dot live" />
            <div>
              <strong>{PHASE_LABEL[phase]}</strong>
              <p>{progress}</p>
            </div>
          </div>
        )}

        {error && <div className="banner">{error}</div>}
        {result && (
          <ReportView
            key={reportKey}
            result={result}
            video={player}
            onSeek={(ms) => void onSeek(ms)}
            onAnalyzeAnother={resetForAnotherVideo}
          />
        )}
      </div>

      <div className="workspace-right">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            className="player"
            onLoadedMetadata={(e) => setPlayer(e.currentTarget)}
            onLoadedData={(e) => setPlayer(e.currentTarget)}
          />
        ) : (
          <div className="player placeholder">Video appears here after upload.</div>
        )}
      </div>
    </div>
  )
}

function readDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const d = video.duration
      video.src = ''
      if (!Number.isFinite(d)) reject(new Error('Could not read video duration.'))
      else resolve(d)
    }
    video.onerror = () => reject(new Error('Could not read this video file.'))
    video.src = url
  })
}
