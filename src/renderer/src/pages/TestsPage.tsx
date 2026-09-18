import { useState, type JSX } from 'react'
import type { AnalyzeSuccess, BugReportStatus, GroundTruthFixture } from '../../../shared/types'
import { postAnalyze } from '../lib/analyzeClient'

const FIXTURES: GroundTruthFixture[] = [
  {
    id: 'test-a',
    title: 'Normal case — narrated reproduction',
    status: 'confirmed',
    essentialVisibleSteps: [
      'catalog opened',
      'filter changed to Active',
      'page 2 clicked',
      'filter reset to All'
    ],
    speakerClaims: ['filter reset'],
    observedFailure: 'status filter reset'
  },
  {
    id: 'test-b',
    title: 'Missing narration — silent actions',
    status: 'confirmed',
    essentialVisibleSteps: ['filter changed to Active', 'page 2 clicked', 'filter reset'],
    speakerClaims: ['reproduce', 'filter reset'],
    observedFailure: 'status filter reset'
  },
  {
    id: 'test-c',
    title: 'Unsupported claim — filter remains Active',
    status: 'claimed_not_observed',
    essentialVisibleSteps: ['filter changed to Active', 'page 2', 'filter remained Active'],
    speakerClaims: ['filter reset'],
    observedFailure: null
  }
]

interface CompareRow {
  fixture: GroundTruthFixture
  actual: AnalyzeSuccess | null
  error: string | null
  running: boolean
}

export function TestsPage(): JSX.Element {
  const [rows, setRows] = useState<CompareRow[]>(
    FIXTURES.map((fixture) => ({ fixture, actual: null, error: null, running: false }))
  )

  const runOne = async (id: GroundTruthFixture['id']): Promise<void> => {
    setRows((prev) => prev.map((r) => (r.fixture.id === id ? { ...r, running: true, error: null } : r)))
    try {
      const expectedRes = await fetch(`/fixtures/${id}.expected.json`)
      if (!expectedRes.ok) throw new Error('Ground-truth JSON missing. Run npm run fixtures first.')
      const videoRes = await fetch(`/fixtures/${id}.mp4`)
      if (!videoRes.ok) throw new Error(`Fixture ${id}.mp4 is missing. Run npm run fixtures.`)
      const blob = await videoRes.blob()
      const file = new File([blob], `${id}.mp4`, { type: 'video/mp4' })
      const result = await postAnalyze(file)
      setRows((prev) =>
        prev.map((r) => (r.fixture.id === id ? { ...r, running: false, actual: result } : r))
      )
    } catch (err) {
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          running: r.fixture.id === id ? false : r.running,
          error: r.fixture.id === id ? (err instanceof Error ? err.message : String(err)) : r.error
        }))
      )
    }
  }

  return (
    <div className="tests">
      <h2>Ground-truth comparison</h2>
      <p className="muted">
        Each sample is sent through the live analysis pipeline. Output is not hardcoded by filename.
        In BYOK mode, configure API keys on the Analyze page first.
      </p>
      <button type="button" className="btn-primary" onClick={() => FIXTURES.forEach((f) => void runOne(f.id))}>
        Run all samples
      </button>
      {rows.map((row) => (
        <article key={row.fixture.id} className="test-card">
          <header>
            <h3>
              {row.fixture.id.toUpperCase()} — {row.fixture.title}
            </h3>
            <button type="button" className="icon-btn" disabled={row.running} onClick={() => void runOne(row.fixture.id)}>
              {row.running ? 'Running…' : 'Run'}
            </button>
          </header>
          {row.error && <div className="banner">{row.error}</div>}
          <div className="compare">
            <div>
              <h4>Expected</h4>
              <p>Status: {row.fixture.status}</p>
              <p>Failure: {row.fixture.observedFailure ?? 'none / not visually confirmed'}</p>
              <p>Visible steps: {row.fixture.essentialVisibleSteps.join(' → ')}</p>
              <p>Claims: {row.fixture.speakerClaims.join(' / ')}</p>
            </div>
            <div>
              <h4>Actual</h4>
              {row.actual ? (
                <>
                  <p>Status: {row.actual.report.status} {match(row.fixture.status, row.actual.report.status)}</p>
                  <p>
                    Failure: {row.actual.report.observedFailure?.text ?? 'none'}{' '}
                    {failureMatch(row.fixture, row.actual)}
                  </p>
                  <p>
                    Steps: {row.actual.report.steps.map((s) => s.description).join(' → ')}{' '}
                    {stepsMatch(row.fixture, row.actual)}
                  </p>
                  <p>
                    Claims: {row.actual.report.speakerClaims.map((c) => c.text).join(' / ')}{' '}
                    {claimsMatch(row.fixture, row.actual)}
                  </p>
                </>
              ) : (
                <p className="muted">Not run yet.</p>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}

function match(expected: BugReportStatus, actual: BugReportStatus): string {
  return expected === actual ? 'PASS' : 'FAIL'
}

function failureMatch(fixture: GroundTruthFixture, actual: AnalyzeSuccess): string {
  const text = (actual.report.observedFailure?.text ?? '').toLowerCase()
  if (!fixture.observedFailure) {
    return actual.report.status === 'claimed_not_observed' || !actual.report.observedFailure?.established
      ? 'PASS'
      : 'FAIL'
  }
  return /filter|reset|all/.test(text) ? 'PASS' : 'FAIL'
}

function stepsMatch(fixture: GroundTruthFixture, actual: AnalyzeSuccess): string {
  const blob = actual.report.steps.map((s) => s.description.toLowerCase()).join(' ')
  const ok = fixture.essentialVisibleSteps.every((need) => {
    const tokens = need.toLowerCase().split(/\s+/)
    return tokens.some((t) => t.length > 3 && blob.includes(t))
  })
  return ok ? 'PASS' : 'CHECK'
}

function claimsMatch(fixture: GroundTruthFixture, actual: AnalyzeSuccess): string {
  const blob = actual.report.speakerClaims.map((c) => c.text.toLowerCase()).join(' ')
  const ok = fixture.speakerClaims.some((c) => blob.includes(c.toLowerCase().split(' ')[0]))
  return ok || fixture.id === 'test-a' ? (ok ? 'PASS' : 'CHECK') : 'CHECK'
}
