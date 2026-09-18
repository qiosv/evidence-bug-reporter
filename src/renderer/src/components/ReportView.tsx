import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { EvidenceLabel } from './EvidenceLabel'
import { captureFrame } from '../lib/frameCapture'
import { formatUsd } from '../../../metrics/cost'
import { formatTimestamp } from '../../../shared/id'
import type {
  AnalyzeSuccess,
  EvidenceStatement,
  PrimaryFinding,
  ReproductionStep
} from '../../../shared/types'

interface Props {
  result: AnalyzeSuccess
  video: HTMLVideoElement | null
  onSeek: (timestampMs: number) => void
  onAnalyzeAnother?: () => void
}

const OUTCOME_LABEL: Record<PrimaryFinding['outcome'], string> = {
  bug_detected: 'BUG DETECTED',
  no_visual_failure: 'NO VISUAL FAILURE CONFIRMED',
  claimed_not_observed: 'FAILURE CLAIMED — NOT VISUALLY CONFIRMED',
  insufficient_evidence: 'INSUFFICIENT EVIDENCE'
}

export function ReportView({ result, video, onSeek, onAnalyzeAnother }: Props): JSX.Element {
  const { report, metrics } = result
  const finding = report.primaryFinding
  const [frames, setFrames] = useState<Record<number, string>>({})
  const [frameError, setFrameError] = useState<string | null>(null)

  useEffect(() => {
    if (!video) return
    const stamps = [
      finding?.timestampMs,
      ...report.startingConditions.map((s) => s.timestampMs),
      ...report.steps.map((s) => s.frameTimestampMs ?? s.timestampMs),
      report.observedFailure?.timestampMs
    ].filter((n): n is number => typeof n === 'number')
    const unique = [...new Set(stamps)].slice(0, 10)
    let cancelled = false
    ;(async () => {
      const next: Record<number, string> = {}
      for (const ts of unique) {
        try {
          next[ts] = await captureFrame(video, ts)
        } catch (err) {
          if (!cancelled) setFrameError(err instanceof Error ? err.message : String(err))
        }
      }
      if (!cancelled) setFrames(next)
    })()
    return () => {
      cancelled = true
    }
  }, [report, video, finding?.timestampMs])

  const previewEvidence = report.evidence.filter((item) => finding.evidenceIds.includes(item.id))
  const previewItems =
    previewEvidence.length > 0
      ? previewEvidence
      : report.evidence.filter((item) =>
          typeof finding.timestampMs === 'number'
            ? Math.abs(item.timestampMs - finding.timestampMs) < 800
            : false
        )

  return (
    <article className="report">
      <PrimaryFindingCard finding={finding} frame={frameAt(frames, finding.timestampMs)} onSeek={onSeek} />
      {onAnalyzeAnother && (
        <div className="report-actions">
          <button type="button" className="btn-primary" onClick={onAnalyzeAnother}>
            Analyze another video
          </button>
        </div>
      )}

      {previewItems.length > 0 && (
        <Section title="Evidence preview">
          <ul className="unknown-list">
            {previewItems.map((item) => (
              <li key={item.id}>
                <EvidenceLabel source={item.source} timestampMs={item.timestampMs} onSeek={onSeek} />
                {item.label}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Starting conditions">
        {report.startingConditions.map((s, i) => (
          <StatementRow key={i} statement={s} frame={frameAt(frames, s.timestampMs)} onSeek={onSeek} />
        ))}
      </Section>

      <Section title="Steps to reproduce">
        {report.steps.map((step) => (
          <StepRow
            key={step.index}
            step={step}
            frame={frameAt(frames, step.frameTimestampMs ?? step.timestampMs)}
            onSeek={onSeek}
          />
        ))}
      </Section>

      <Section title="Observed failure details">
        {report.observedFailure ? (
          <StatementRow
            statement={report.observedFailure}
            frame={frameAt(frames, report.observedFailure.timestampMs)}
            onSeek={onSeek}
          />
        ) : (
          <p className="muted">No failure visually confirmed.</p>
        )}
      </Section>

      <Section title="Speaker claims">
        {report.speakerClaims.length === 0 && <p className="muted">No speech claims in this recording.</p>}
        {report.speakerClaims.map((s, i) => (
          <StatementRow key={i} statement={s} onSeek={onSeek} />
        ))}
      </Section>

      <Section title="Expected behavior">
        <p>
          <EvidenceLabel source={report.expectedBehavior.established ? 'visible' : 'unknown'} />
          {report.expectedBehavior.value ?? 'Unknown. Not established by evidence.'}
        </p>
        {!report.expectedBehavior.established && <p className="muted">{report.expectedBehavior.source}</p>}
      </Section>

      <Section title="Unknowns">
        <ul className="unknown-list">
          {report.unknowns.map((item) => (
            <li key={item}>
              <EvidenceLabel source="unknown" /> {item}
            </li>
          ))}
        </ul>
      </Section>

      <details className="evidence-full">
        <summary>Full evidence</summary>
        {report.evidence.length === 0 && <p className="muted">No clickable visual evidence timestamps.</p>}
        <ul className="unknown-list">
          {report.evidence.map((item) => (
            <li key={item.id}>
              <EvidenceLabel source={item.source} timestampMs={item.timestampMs} onSeek={onSeek} />
              {item.label}
            </li>
          ))}
        </ul>
      </details>

      {frameError && <p className="banner">{frameError}</p>}

      <Section title="Processing metrics">
        <dl className="metrics">
          <dt>Validate</dt>
          <dd>{metrics.timings.validationMs ?? metrics.timings.uploadMs} ms</dd>
          <dt>Transcription</dt>
          <dd>{metrics.timings.transcriptionMs} ms</dd>
          <dt>Video analysis</dt>
          <dd>{metrics.timings.videoAnalysisMs} ms</dd>
          <dt>Report generation</dt>
          <dd>{metrics.timings.reportGenerationMs} ms</dd>
          <dt>Total</dt>
          <dd>{metrics.timings.totalMs} ms</dd>
          <dt>Time to useful result</dt>
          <dd>{metrics.timings.timeToUsefulResultMs ?? metrics.timings.totalMs} ms</dd>
          <dt>AI calls</dt>
          <dd>{metrics.usage.aiCallCount}</dd>
          <dt>Retries</dt>
          <dd>{metrics.usage.retryCount}</dd>
          <dt>Input tokens</dt>
          <dd>{metrics.usage.inputTokens ?? 'not reported'}</dd>
          <dt>Output tokens</dt>
          <dd>{metrics.usage.outputTokens ?? 'not reported'}</dd>
          <dt>Cached input tokens</dt>
          <dd>{metrics.usage.cachedInputTokens ?? 'not reported'}</dd>
          <dt>STT model</dt>
          <dd>{metrics.usage.sttModel ?? '—'}</dd>
          <dt>Gemini model</dt>
          <dd>{metrics.usage.geminiModel ?? '—'}</dd>
          <dt>Gemini delivery</dt>
          <dd>{metrics.usage.geminiDelivery ?? '—'}</dd>
          <dt>Transcript segments</dt>
          <dd>{metrics.usage.segmentCount ?? result.transcript.length}</dd>
          <dt>Audio duration</dt>
          <dd>{(metrics.usage.audioDurationMs / 1000).toFixed(1)} s</dd>
          <dt>Video duration</dt>
          <dd>{(metrics.usage.videoDurationMs / 1000).toFixed(1)} s</dd>
        </dl>
      </Section>

      <Section title="Estimated provider usage cost">
        <dl className="metrics">
          <dt>STT</dt>
          <dd>{formatUsd(metrics.cost.sttUsd)}</dd>
          <dt>Video / model input</dt>
          <dd>{formatUsd(metrics.cost.videoInputUsd)}</dd>
          <dt>Model output</dt>
          <dd>{formatUsd(metrics.cost.modelOutputUsd)}</dd>
          <dt>Retry</dt>
          <dd>{formatUsd(metrics.cost.retryUsd)}</dd>
          <dt>Total variable</dt>
          <dd>{formatUsd(metrics.cost.totalVariableUsd)}</dd>
        </dl>
        <p className="muted">{metrics.cost.hostingNote}</p>
        <p className="muted">
          Charges are billed by the API providers associated with the keys used for this request.
          This application does not charge this amount.
        </p>
        <p className="muted">
          Assumptions:{' '}
          {metrics.cost.assumptions.sttProvider === 'groq' ? 'Groq' : 'xAI Speech-to-Text'}{' '}
          {metrics.cost.assumptions.groqModel} at $
          {metrics.cost.assumptions.sttUsdPerHour ?? metrics.cost.assumptions.groqWhisperUsdPerHour}
          /hour; Gemini {metrics.cost.assumptions.geminiModel} at $
          {metrics.cost.assumptions.geminiInputUsdPerMillion}/1M input and $
          {metrics.cost.assumptions.geminiOutputUsdPerMillion}/1M output. Free credits are not
          treated as zero cost.
        </p>
      </Section>
    </article>
  )
}

function PrimaryFindingCard({
  finding,
  frame,
  onSeek
}: {
  finding: PrimaryFinding
  frame?: string
  onSeek: (timestampMs: number) => void
}): JSX.Element {
  const sourceLabel =
    finding.source === 'visible'
      ? 'Visual evidence'
      : finding.source === 'speaker_claim'
        ? 'Speaker claim'
        : finding.source === 'mixed'
          ? 'Speaker claim vs visual evidence'
          : 'Unknown'

  return (
    <section className={`primary-finding ${finding.outcome}`}>
      <p className="primary-outcome">{OUTCOME_LABEL[finding.outcome]}</p>
      <h2>{finding.title}</h2>
      <div className="primary-block">
        <h3>What happened</h3>
        <p>{finding.explanation}</p>
      </div>
      {(finding.preState || finding.action || finding.postState) && (
        <div className="primary-block">
          <h3>Evidence</h3>
          <p className="pre-post">
            <span>{finding.preState ?? '—'}</span>
            <span aria-hidden="true">→</span>
            <span>{finding.action ?? '—'}</span>
            <span aria-hidden="true">→</span>
            <span>{finding.postState ?? '—'}</span>
          </p>
        </div>
      )}
      <dl className="primary-meta">
        {typeof finding.timestampMs === 'number' && (
          <>
            <dt>Timestamp</dt>
            <dd>
              <button
                type="button"
                className="ts-btn"
                onClick={() => onSeek(finding.timestampMs as number)}
              >
                {formatTimestamp(finding.timestampMs)}
              </button>
            </dd>
          </>
        )}
        <dt>Source</dt>
        <dd>{sourceLabel}</dd>
        {typeof finding.confidence === 'number' && (
          <>
            <dt>Confidence</dt>
            <dd>{Math.round(finding.confidence * 100)}%</dd>
          </>
        )}
        <dt>Root cause</dt>
        <dd>{finding.rootCause || 'Unknown'}</dd>
      </dl>
      {frame && <img src={frame} alt="" className="ev-frame" />}
    </section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="report-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function StatementRow({
  statement,
  frame,
  onSeek
}: {
  statement: EvidenceStatement
  frame?: string
  onSeek: (timestampMs: number) => void
}): JSX.Element {
  return (
    <div className={`ev-row ${statement.source}`}>
      <EvidenceLabel source={statement.source} timestampMs={statement.timestampMs} onSeek={onSeek} />
      <p>{statement.text}</p>
      {frame && <img src={frame} alt="" className="ev-frame" />}
    </div>
  )
}

function StepRow({
  step,
  frame,
  onSeek
}: {
  step: ReproductionStep
  frame?: string
  onSeek: (timestampMs: number) => void
}): JSX.Element {
  return (
    <div className={`ev-row ${step.source}`}>
      <div className="step-line">
        <span className="step-index">{step.index}.</span>
        <p>{step.description}</p>
        <EvidenceLabel source={step.source} timestampMs={step.timestampMs} onSeek={onSeek} />
      </div>
      {frame && <img src={frame} alt="" className="ev-frame" />}
    </div>
  )
}

function frameAt(frames: Record<number, string>, ts?: number): string | undefined {
  if (typeof ts !== 'number') return undefined
  return frames[ts]
}
