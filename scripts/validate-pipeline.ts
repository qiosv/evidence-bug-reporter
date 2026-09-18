import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { requireEnv } from '../server/env'
import { analyzeRecording } from '../server/analyze'
import { createSttProvider, sttIsConfigured, activeSttModel } from '../src/transcription/select'
import { extractAudioWav, extractMetadata } from '../src/video/metadata'
import type { AnalyzeSuccess, GroundTruthFixture, PrimaryFinding } from '../src/shared/types'
import { interactionChoosesValue } from '../src/analysis/stateTracking'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIX = join(ROOT, 'tests/fixtures')
const OUT = join(ROOT, 'tests/results')
mkdirSync(OUT, { recursive: true })

function loadExpected(id: string): GroundTruthFixture {
  return JSON.parse(readFileSync(join(FIX, `${id}.expected.json`), 'utf8')) as GroundTruthFixture
}

function visibleBlob(result: AnalyzeSuccess): string {
  return [
    ...result.report.startingConditions.map((s) => s.text),
    ...result.report.steps.map((s) => s.description),
    result.report.observedFailure?.text ?? ''
  ]
    .join(' ')
    .toLowerCase()
}

function looksLikeIntendedDirectChange(finding: PrimaryFinding | undefined): boolean {
  if (!finding || finding.outcome !== 'bug_detected') return false
  if (!finding.action || !finding.postState) return false
  const after = finding.postState.replace(/^[^:]+:\s*/, '').trim()
  if (!after) return false
  return interactionChoosesValue(
    {
      timestampMs: finding.timestampMs ?? 0,
      interaction: finding.action,
      stateBefore: [],
      stateAfter: []
    },
    after
  )
}

function judgePrimary(result: AnalyzeSuccess, notes: string[]): void {
  const finding = result.report.primaryFinding
  if (!finding) {
    notes.push('primary finding missing')
    return
  }
  if (looksLikeIntendedDirectChange(finding)) {
    notes.push('direct intended UI change was promoted to the primary failure')
  }
  if (finding.outcome === 'bug_detected' && finding.source !== 'visible') {
    notes.push('confirmed bug primary finding is not visual')
  }
}
function evalFixture(id: 'test-a' | 'test-b' | 'test-c', result: AnalyzeSuccess): { pass: boolean; notes: string[] } {
  const expected = loadExpected(id)
  const notes: string[] = []
  judgePrimary(result, notes)
  if (id === 'test-a' || id === 'test-b') {
    if (result.report.primaryFinding.outcome !== 'bug_detected') {
      notes.push(`primary outcome expected bug_detected actual ${result.report.primaryFinding.outcome}`)
    }
  }
  if (id === 'test-c' && result.report.primaryFinding.outcome === 'bug_detected') {
    notes.push('C primary finding must not be bug_detected')
  }
  if (result.report.status !== expected.status) {
    notes.push(`status expected ${expected.status} actual ${result.report.status}`)
  }
  const blob = visibleBlob(result)
  for (const need of expected.essentialVisibleSteps) {
    const tokens = need.toLowerCase().split(/\s+/).filter((t) => t.length > 3)
    const hit = tokens.some((t) => blob.includes(t))
    if (!hit) notes.push(`missing visible step token from: ${need}`)
  }
  if (id === 'test-b') {
    const silentOk = /active/i.test(blob) && /page/i.test(blob)
    if (!silentOk) notes.push('silent visible actions were not recovered')
    const visibleSteps = result.report.steps.filter((s) => s.source === 'visible')
    if (visibleSteps.length < 2) notes.push('too few visible steps for missing-narration case')
  }
  if (id === 'test-c') {
    if (result.report.status === 'confirmed') notes.push('release-blocking: unsupported claim became confirmed')
    const fail = result.report.observedFailure
    if (fail?.established && fail.source === 'visible' && /reset/i.test(fail.text)) {
      notes.push('observedFailure treated speaker claim as visible')
    }
  }
  if (/stack trace|http 5\d\d|root cause is that/i.test(result.report.summary + result.report.unknowns.join(' '))) {
    notes.push('possible invented technical root cause')
  }
  if (result.report.expectedBehavior.established) {
    notes.push('expected behavior marked established — verify it was on screen')
  }
  return { pass: notes.length === 0, notes }
}

async function transcribeFixture(env: ReturnType<typeof requireEnv>): Promise<void> {
  const mp4 = join(FIX, 'test-a.mp4')
  const wav = join(ROOT, 'tmp', 'validate-a.wav')
  mkdirSync(join(ROOT, 'tmp'), { recursive: true })
  const meta = await extractMetadata(mp4, 'video/mp4')
  const wavOk = await extractAudioWav(mp4, wav)
  const stt = createSttProvider(env)
  const started = Date.now()
  const result = await stt.transcribe(wavOk ? wav : mp4, wavOk ? 'audio/wav' : 'video/mp4')
  const ms = Date.now() - started
  const label = env.transcriptionProvider
  console.log(`[${label}] model`, activeSttModel(env))
  console.log(`[${label}] videoDurationMs`, meta.durationMs, 'audioDurationMs', result.durationMs)
  console.log(`[${label}] segmentCount`, result.segments.length)
  console.log(`[${label}] wordCount`, result.wordCount ?? 'n/a')
  console.log(`[${label}] transcriptionMs`, ms)
  console.log(`[${label}] textChars`, result.text.length)
  if (!result.text && result.segments.length === 0) {
    throw new Error('STT returned empty transcript for a narrated fixture')
  }
  const badSeg = result.segments.find((s) => typeof s.startMs !== 'number' || typeof s.endMs !== 'number')
  if (badSeg) throw new Error('STT segment missing start/end')
  writeFileSync(
    join(OUT, `${label}-test-a.json`),
    JSON.stringify({ text: result.text, language: result.language, segments: result.segments }, null, 2)
  )
}

async function runOne(id: string, env: ReturnType<typeof requireEnv>): Promise<AnalyzeSuccess> {
  const file = join(FIX, `${id}.mp4`)
  const result = await analyzeRecording(
    { path: file, originalName: `${id}.mp4`, mimeType: 'video/mp4' },
    env,
    (phase, message) => console.log(`[${id}]`, phase, message)
  )
  writeFileSync(join(OUT, `${id}.actual.json`), JSON.stringify(result, null, 2))
  const tmpDir = join(ROOT, 'tmp')
  mkdirSync(tmpDir, { recursive: true })
  writeFileSync(
    join(tmpDir, `${id}-transcript.json`),
    JSON.stringify({ text: result.transcript.map((s) => s.text).join(' '), segments: result.transcript }, null, 2)
  )
  writeFileSync(join(tmpDir, `${id}-visual.json`), JSON.stringify(result.visual, null, 2))
  writeFileSync(join(tmpDir, `${id}-report.json`), JSON.stringify(result.report, null, 2))
  return result
}

async function main(): Promise<void> {
  const loaded = requireEnv()
  const env = { ...loaded, apiKeyMode: 'server' as const }
  console.log(`api_key_mode=${env.apiKeyMode}`)
  console.log(`transcription_provider=${env.transcriptionProvider}`)
  console.log(`xAI: ${env.xaiApiKey ? 'configured' : 'missing'}`)
  console.log(`Groq: ${env.groqApiKey ? 'configured' : 'missing'}`)
  console.log(`Gemini: ${env.geminiApiKey ? 'configured' : 'missing'}`)
  if (!sttIsConfigured(env) || !env.geminiApiKey) {
    console.error('Copy .env.example to .env and set XAI_API_KEY (or GROQ_API_KEY) and GEMINI_API_KEY.')
    process.exit(2)
  }

  await transcribeFixture(env)

  const silent = join(ROOT, 'tmp', 'silent.mp4')
  const stripped = spawnSync(
    'ffmpeg',
    ['-y', '-i', join(FIX, 'test-a.mp4'), '-an', '-c:v', 'copy', silent],
    { windowsHide: true }
  )
  if (stripped.status === 0) {
    const silentResult = await analyzeRecording(
      { path: silent, originalName: 'silent.mp4', mimeType: 'video/mp4' },
      env,
      (phase, message) => console.log('[silent]', phase, message)
    )
    writeFileSync(join(OUT, 'silent.actual.json'), JSON.stringify(silentResult.report, null, 2))
    console.log('[silent] no-audio is not an error. status', silentResult.report.status)
  }

  const results: Record<string, { pass: boolean; notes: string[]; timings: AnalyzeSuccess['metrics']['timings']; cost: AnalyzeSuccess['metrics']['cost'] }> = {}
  for (const id of ['test-a', 'test-b', 'test-c'] as const) {
    const actual = await runOne(id, env)
    const judged = evalFixture(id, actual)
    results[id] = {
      pass: judged.pass,
      notes: judged.notes,
      timings: actual.metrics.timings,
      cost: actual.metrics.cost
    }
    console.log(`[${id}]`, judged.pass ? 'PASS' : 'FAIL', judged.notes.join('; ') || 'ok')
    console.log(`[${id}] primary`, actual.report.primaryFinding.outcome, actual.report.primaryFinding.title)
    console.log(`[${id}] total_ms`, actual.metrics.timings.totalMs, 'cost', actual.metrics.cost.totalVariableUsd)
  }

  const newInput = await runOne('new-input', env)
  results['new-input'] = {
    pass: true,
    notes: [
      `status=${newInput.report.status}`,
      `steps=${newInput.report.steps.length}`,
      `visibleSteps=${newInput.report.steps.filter((s) => s.source === 'visible').length}`
    ],
    timings: newInput.metrics.timings,
    cost: newInput.metrics.cost
  }
  console.log('[new-input] processed', newInput.report.status, 'steps', newInput.report.steps.length)
  console.log('[new-input] total_ms', newInput.metrics.timings.totalMs, 'cost', newInput.metrics.cost.totalVariableUsd)

  const extra: Array<{
    id: string
    judge: (result: AnalyzeSuccess) => { pass: boolean; notes: string[] }
  }> = [
    {
      id: 'silent-demo',
      judge: (result) => {
        const notes: string[] = []
        judgePrimary(result, notes)
        if (result.report.status !== 'confirmed') {
          notes.push(`silent demo expected confirmed actual ${result.report.status}`)
        }
        if (result.report.primaryFinding.outcome !== 'bug_detected') {
          notes.push(`silent demo primary expected bug_detected actual ${result.report.primaryFinding.outcome}`)
        }
        if (!result.report.primaryFinding.preState || !result.report.primaryFinding.postState) {
          notes.push('silent demo primary finding missing pre/post state')
        }
        if (result.report.observedFailure?.source !== 'visible' || !result.report.observedFailure.established) {
          notes.push('silent demo lost the visible post-action state change')
        }
        if (result.report.expectedBehavior.established) {
          notes.push('silent demo invented expected behavior')
        }
        return { pass: notes.length === 0, notes }
      }
    },
    {
      id: 'healthy-demo',
      judge: (result) => {
        const notes: string[] = []
        judgePrimary(result, notes)
        if (result.report.primaryFinding.outcome === 'bug_detected') {
          notes.push('healthy catalog invented a primary bug')
        }
        if (result.report.status !== 'no_failure_observed') {
          notes.push(`healthy catalog expected no_failure_observed actual ${result.report.status}`)
        }
        return { pass: notes.length === 0, notes }
      }
    },
    {
      id: 'form-bug',
      judge: (result) => {
        const notes: string[] = []
        const blob = visibleBlob(result)
        judgePrimary(result, notes)
        if (result.report.status !== 'confirmed') {
          notes.push(`unrelated buggy app expected confirmed actual ${result.report.status}`)
        }
        if (result.report.observedFailure?.source !== 'visible' || !result.report.observedFailure.established) {
          notes.push('unrelated buggy app did not establish a visible failure')
        }
        if (!/sam|rivera|name|blank|empty/i.test(blob)) {
          notes.push('unrelated buggy app did not recover the form-field transition from the video')
        }
        if (result.report.expectedBehavior.established) {
          notes.push('unrelated buggy app invented expected behavior')
        }
        return { pass: notes.length === 0, notes }
      }
    },
    {
      id: 'form-ok',
      judge: (result) => {
        const notes: string[] = []
        judgePrimary(result, notes)
        if (result.report.status === 'confirmed') {
          notes.push('unrelated healthy app invented a bug')
        }
        if (result.report.status !== 'no_failure_observed') {
          notes.push(`unrelated healthy app expected no_failure_observed actual ${result.report.status}`)
        }
        return { pass: notes.length === 0, notes }
      }
    }
  ]

  for (const item of extra) {
    const actual = await runOne(item.id, env)
    const judged = item.judge(actual)
    results[item.id] = {
      pass: judged.pass,
      notes: judged.notes,
      timings: actual.metrics.timings,
      cost: actual.metrics.cost
    }
    console.log(`[${item.id}]`, judged.pass ? 'PASS' : 'FAIL', judged.notes.join('; ') || 'ok')
    console.log(
      `[${item.id}] primary`,
      actual.report.primaryFinding.outcome,
      actual.report.primaryFinding.title
    )
    console.log(`[${item.id}] total_ms`, actual.metrics.timings.totalMs, 'cost', actual.metrics.cost.totalVariableUsd)
  }

  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(results, null, 2))
  const gated = ['test-a', 'test-b', 'test-c', 'silent-demo', 'healthy-demo', 'form-bug', 'form-ok']
  if (gated.some((id) => !results[id]?.pass)) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
