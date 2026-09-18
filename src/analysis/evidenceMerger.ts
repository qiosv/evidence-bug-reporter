import type {
  BugReport,
  EvidenceEvent,
  EvidenceReference,
  EvidenceStatement,
  PrimaryFinding,
  ReproductionStep,
  TranscriptSegment,
  VisualAnalysis
} from '../shared/types'
import { coerceTimestampMs, uid } from '../shared/id'
import {
  applyTemporalContinuity,
  collectFailureCandidates,
  interactionChoosesValue,
  normKey,
  type FailureCandidate
} from './stateTracking'

const FAILURE_CLAIM =
  /\b(reset|broke|broken|bug|fail(?:ed|ure)?|wrong|didn't|did not|doesn't|does not|not working|went back|reverted|lost|missing)\b/i

export interface MergeInput {
  transcript: TranscriptSegment[]
  visual: VisualAnalysis
  videoDurationMs: number
}

export interface MergeOutput {
  events: EvidenceEvent[]
  report: BugReport
}

export function mergeEvidence(input: MergeInput): MergeOutput {
  const visual = applyContradictionOverride(
    inferVisibleFailures(
      applyTemporalContinuity(normalizeVisual(input.visual, input.videoDurationMs))
    )
  )
  const candidates = collectFailureCandidates(
    visual.stateObservations ?? [],
    visual,
    new Set((visual.startingState ?? []).map((prop) => normKey(prop.name)))
  )
  const primaryCandidate = candidates[0] ?? null

  const events: EvidenceEvent[] = []

  for (const cond of visual.startingConditions) {
    events.push({
      id: uid(),
      timestampMs: cond.timestampMs,
      type: 'screen_state',
      source: 'visible',
      description: cond.description,
      frameTimestampMs: cond.timestampMs
    })
  }

  for (const observation of visual.stateObservations ?? []) {
    const summary = compactObservation(observation)
    events.push({
      id: uid(),
      timestampMs: observation.timestampMs,
      type: 'user_action',
      source: 'visible',
      description: summary,
      frameTimestampMs: observation.timestampMs,
      confidence: observation.confidence
    })
  }

  if ((visual.stateObservations ?? []).length === 0) {
    for (const action of visual.visibleActions) {
      events.push({
        id: uid(),
        timestampMs: action.timestampMs,
        type: action.type,
        source: 'visible',
        description: action.description,
        frameTimestampMs: action.timestampMs
      })
    }
  }

  for (const failure of visual.visibleFailures) {
    events.push({
      id: uid(),
      timestampMs: failure.timestampMs,
      type: 'failure',
      source: 'visible',
      description: failure.description,
      frameTimestampMs: failure.timestampMs
    })
  }

  for (const segment of input.transcript) {
    const text = segment.text.trim()
    if (!text) continue
    events.push({
      id: uid(),
      timestampMs: segment.startMs,
      type: 'speaker_statement',
      source: 'speaker_claim',
      description: text,
      metadata: { endMs: segment.endMs }
    })
  }

  for (const contradiction of visual.speakerVisualContradictions) {
    events.push({
      id: uid(),
      timestampMs: contradiction.timestampMs,
      type: 'verification',
      source: 'visible',
      description: `Contradiction — speaker claimed “${contradiction.speakerClaim}”; visible: ${contradiction.visibleEvidence}`,
      frameTimestampMs: contradiction.timestampMs
    })
  }

  events.sort((a, b) => a.timestampMs - b.timestampMs)

  const speakerClaims = collectSpeakerClaims(input.transcript, visual)
  const visibleFailure = pickVisibleFailure(visual, speakerClaims, primaryCandidate)
  const status = deriveStatus(visual, speakerClaims, visibleFailure, input.transcript)

  const startingConditions: EvidenceStatement[] = visual.startingConditions.map((c) => ({
    text: c.description,
    source: 'visible' as const,
    timestampMs: c.timestampMs,
    established: true
  }))

  if (startingConditions.length === 0) {
    startingConditions.push({
      text: 'Starting UI was not established from the recording.',
      source: 'unknown',
      established: false
    })
  }

  const steps = buildSteps(visual)
  const unknowns = uniqueUnknowns([...(visual.unknowns ?? [])])
  const expected = visual.expectedBehaviorFromUi
  const expectedBehavior = {
    value: expected.established ? expected.value : expected.value,
    established: expected.established === true && Boolean(expected.value),
    source: expected.established
      ? expected.source ?? 'visible'
      : 'UNKNOWN — not established by evidence.'
  }
  if (!expectedBehavior.established) {
    expectedBehavior.value = expected.value
      ? `${expected.value} (not established by evidence)`
      : null
  }

  const evidence = dedupeEvidence(
    events
      .filter((e) => e.source === 'visible' && e.timestampMs >= 0)
      .map((e) => ({
        id: e.id,
        timestampMs: e.frameTimestampMs ?? e.timestampMs,
        source: e.source,
        label: e.description
      }))
  )

  const primaryFinding = buildPrimaryFinding({
    status,
    candidate: primaryCandidate,
    visibleFailure,
    speakerClaims,
    visual,
    events
  })

  const title = primaryFinding.title
  const summary = buildSummary({
    status,
    startingConditions,
    steps,
    visibleFailure,
    speakerClaims,
    primaryFinding
  })

  const report: BugReport = {
    title,
    status,
    primaryFinding,
    startingConditions,
    steps,
    observedFailure: visibleFailure,
    speakerClaims,
    expectedBehavior,
    unknowns,
    summary,
    evidence
  }

  return { events, report }
}

const VISIBLE_DEFECT =
  /\b(reverted|reverts|went back|changes back|changed back|back to|unexpectedly|does not persist|didn't persist|did not persist|disappeared|emptied|cleared without|without (?:a )?(?:visible )?(?:click|interaction)|no visible (?:response|change))\b/i

function uniqueTokens(text: string): string[] {
  const seen = new Set<string>()
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length > 3) seen.add(token)
  }
  return [...seen]
}

function compactObservation(observation: NonNullable<VisualAnalysis['stateObservations']>[number]): string {
  const changes = observation.changedState ?? []
  const notable = changes.filter((change) => change.relation !== 'secondary_effect')
  const fmt = notable
    .slice(0, 4)
    .map((change) => `${change.name} "${change.before}" → "${change.after}"`)
    .join('; ')
  return fmt ? `${observation.interaction}. ${fmt}` : observation.interaction
}

/** Promote on-screen defect language from actions when visibleFailures was left empty. */
export function inferVisibleFailures(visual: VisualAnalysis): VisualAnalysis {
  if (visual.visibleFailures.length > 0) return visual
  const inferred = visual.visibleActions
    .filter((action) => VISIBLE_DEFECT.test(action.description) && !isDenial(action.description))
    .filter((action) => !isDirectActionProse(action.description, visual))
    .map((action) => ({
      timestampMs: action.timestampMs,
      description: action.description
    }))
  if (inferred.length === 0) return visual
  return { ...visual, visibleFailures: inferred }
}

function isDirectActionProse(description: string, visual: VisualAnalysis): boolean {
  return (visual.stateObservations ?? []).some((observation) => {
    return (observation.changedState ?? []).some((change) => {
      if (change.relation !== 'direct_effect') return false
      const text = description.toLowerCase()
      return text.includes(change.after.toLowerCase()) && interactionChoosesValue(observation, change.after)
    })
  })
}

function isDenial(text: string): boolean {
  return /\b(remain(?:ed|s)|still|did not|doesn't|does not|unchanged|stayed|no reset)\b/i.test(text)
}

function isClaimCopiedAsFailure(failureText: string, speakerClaim: string): boolean {
  const failTokens = uniqueTokens(failureText)
  const claimTokens = uniqueTokens(speakerClaim)
  if (failTokens.length === 0 || claimTokens.length === 0) return false
  const overlap = failTokens.filter((t) => claimTokens.includes(t)).length
  const shorter = Math.min(failTokens.length, claimTokens.length)
  const union = new Set([...failTokens, ...claimTokens]).size
  return overlap / shorter >= 0.6 || overlap / union >= 0.5
}

/**
 * Drop visibleFailures that merely copy a speaker claim when Gemini also recorded
 * that the screen contradicts that claim. Shared generic words are not enough.
 */
export function applyContradictionOverride(visual: VisualAnalysis): VisualAnalysis {
  if (visual.speakerVisualContradictions.length === 0) return visual
  const visibleFailures = visual.visibleFailures.filter((failure) => {
    return !visual.speakerVisualContradictions.some((contradiction) =>
      isClaimCopiedAsFailure(failure.description, contradiction.speakerClaim)
    )
  })
  return { ...visual, visibleFailures }
}

function scaleIfLooksLikeSeconds(values: number[], durationMs: number): (ms: number) => number {
  const durationSec = durationMs / 1000
  const max = values.reduce((m, v) => Math.max(m, v), 0)
  const treatAsSeconds = max > 0 && max <= durationSec + 1.5 && durationMs >= 1000
  return (raw: number): number => {
    const coerced = coerceTimestampMs(raw)
    const ms = treatAsSeconds && coerced <= durationSec + 1.5 ? Math.round(coerced * 1000) : coerced
    return Math.min(Math.max(0, ms), Math.max(durationMs, 0))
  }
}

function normalizeVisual(visual: VisualAnalysis, durationMs: number): VisualAnalysis {
  const observations = visual.stateObservations ?? []
  const all = [
    ...visual.startingConditions.map((c) => c.timestampMs),
    ...observations.map((o) => o.timestampMs),
    ...visual.visibleActions.map((a) => a.timestampMs),
    ...visual.visibleFailures.map((f) => f.timestampMs),
    ...visual.speakerVisualContradictions.map((c) => c.timestampMs)
  ].map((n) => coerceTimestampMs(n))
  const scale = scaleIfLooksLikeSeconds(all, durationMs)
  return {
    startingConditions: visual.startingConditions.map((c) => ({
      ...c,
      timestampMs: scale(c.timestampMs)
    })),
    startingState: visual.startingState ?? [],
    stateObservations: observations.map((obs) => ({
      ...obs,
      timestampMs: scale(obs.timestampMs),
      stateBefore: obs.stateBefore ?? [],
      stateAfter: obs.stateAfter ?? []
    })),
    visibleActions: visual.visibleActions.map((a) => ({
      ...a,
      timestampMs: scale(a.timestampMs)
    })),
    visibleFailures: visual.visibleFailures.map((f) => ({
      ...f,
      timestampMs: scale(f.timestampMs)
    })),
    speakerVisualContradictions: visual.speakerVisualContradictions.map((c) => ({
      ...c,
      timestampMs: scale(c.timestampMs)
    })),
    expectedBehaviorFromUi: visual.expectedBehaviorFromUi,
    unknowns: visual.unknowns ?? []
  }
}

function collectSpeakerClaims(
  transcript: TranscriptSegment[],
  visual: VisualAnalysis
): EvidenceStatement[] {
  const fromTranscript = transcript
    .map((s) => s.text.trim())
    .filter(Boolean)
    .map((text, i) => ({
      text,
      source: 'speaker_claim' as const,
      timestampMs: transcript[i].startMs,
      established: false
    }))

  const extra = visual.speakerVisualContradictions.map((c) => ({
    text: c.speakerClaim,
    source: 'speaker_claim' as const,
    timestampMs: c.timestampMs,
    established: false
  }))

  const seen = new Set<string>()
  const out: EvidenceStatement[] = []
  for (const claim of [...fromTranscript, ...extra]) {
    const key = claim.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(claim)
  }
  return out
}

function pickVisibleFailure(
  visual: VisualAnalysis,
  speakerClaims: EvidenceStatement[],
  candidate: FailureCandidate | null
): EvidenceStatement | null {
  if (candidate) {
    return {
      text: candidate.description,
      source: 'visible',
      timestampMs: candidate.timestampMs,
      established: true
    }
  }
  if (visual.visibleFailures.length > 0) {
    const f = visual.visibleFailures[0]
    return {
      text: f.description,
      source: 'visible',
      timestampMs: f.timestampMs,
      established: true
    }
  }

  const claimed = speakerClaims.find((c) => FAILURE_CLAIM.test(c.text))
  if (claimed && visual.speakerVisualContradictions.length > 0) {
    return null
  }
  return null
}

function deriveStatus(
  visual: VisualAnalysis,
  speakerClaims: EvidenceStatement[],
  visibleFailure: EvidenceStatement | null,
  transcript: TranscriptSegment[]
): BugReport['status'] {
  const claimsFailure = speakerClaims.some((c) => FAILURE_CLAIM.test(c.text))
  const hasContradiction = visual.speakerVisualContradictions.length > 0
  const hasVisibleFailure = Boolean(visibleFailure) || visual.visibleFailures.length > 0
  const hasSpeech = transcript.some((segment) => segment.text.trim())

  if (hasVisibleFailure) return 'confirmed'
  if (claimsFailure && !hasVisibleFailure) return 'claimed_not_observed'
  if (hasContradiction && !hasVisibleFailure) return 'claimed_not_observed'
  if (visual.visibleActions.length === 0 && !hasSpeech && (visual.stateObservations ?? []).length === 0) {
    return 'insufficient_evidence'
  }
  return 'no_failure_observed'
}

function buildSteps(visual: VisualAnalysis): ReproductionStep[] {
  const observations = [...(visual.stateObservations ?? [])].sort((a, b) => a.timestampMs - b.timestampMs)
  if (observations.length > 0) {
    return observations.map((observation, i) => ({
      index: i + 1,
      description: compactObservation(observation),
      timestampMs: observation.timestampMs,
      source: 'visible' as const,
      frameTimestampMs: observation.timestampMs
    }))
  }
  const items = [...visual.visibleActions].sort((a, b) => a.timestampMs - b.timestampMs)
  if (items.length === 0) {
    return visual.startingConditions.map((c, i) => ({
      index: i + 1,
      description: c.description,
      timestampMs: c.timestampMs,
      source: 'visible' as const,
      frameTimestampMs: c.timestampMs
    }))
  }
  return items.map((a, i) => ({
    index: i + 1,
    description: a.description,
    timestampMs: a.timestampMs,
    source: 'visible' as const,
    frameTimestampMs: a.timestampMs
  }))
}

function buildPrimaryFinding(args: {
  status: BugReport['status']
  candidate: FailureCandidate | null
  visibleFailure: EvidenceStatement | null
  speakerClaims: EvidenceStatement[]
  visual: VisualAnalysis
  events: EvidenceEvent[]
}): PrimaryFinding {
  const evidenceIdsFor = (timestampMs?: number, snippets: string[] = []): string[] => {
    if (typeof timestampMs !== 'number') return []
    return args.events
      .filter((event) => {
        if (Math.abs(event.timestampMs - timestampMs) > 800) return false
        if (snippets.length === 0) return event.type === 'failure' || event.type === 'user_action'
        const hay = event.description.toLowerCase()
        return snippets.some((snippet) => hay.includes(snippet.toLowerCase()))
      })
      .map((event) => event.id)
  }

  if (args.status === 'confirmed' && args.candidate) {
    return {
      outcome: 'bug_detected',
      title: args.candidate.title,
      explanation: args.candidate.explanation,
      preState: args.candidate.preState,
      action: args.candidate.action,
      postState: args.candidate.postState,
      timestampMs: args.candidate.timestampMs,
      evidenceIds: evidenceIdsFor(args.candidate.timestampMs, [
        args.candidate.change.name,
        args.candidate.change.before,
        args.candidate.change.after
      ]),
      source: 'visible',
      rootCause: null,
      confidence: args.candidate.confidence
    }
  }

  if (args.status === 'confirmed' && args.visibleFailure) {
    return {
      outcome: 'bug_detected',
      title: clipTitle(args.visibleFailure.text),
      explanation: args.visibleFailure.text,
      action: args.visibleFailure.text,
      timestampMs: args.visibleFailure.timestampMs,
      evidenceIds: evidenceIdsFor(args.visibleFailure.timestampMs),
      source: 'visible',
      rootCause: null
    }
  }

  if (args.status === 'claimed_not_observed') {
    const claim = args.speakerClaims.find((c) => FAILURE_CLAIM.test(c.text))
    const contradiction = args.visual.speakerVisualContradictions[0]
    return {
      outcome: 'claimed_not_observed',
      title: 'Failure claimed — not visually confirmed',
      explanation: contradiction
        ? `Speaker claimed “${contradiction.speakerClaim}”. Visible evidence: ${contradiction.visibleEvidence}.`
        : `Speaker claimed “${claim?.text ?? 'a failure'}”. That failure was not visible on screen.`,
      timestampMs: contradiction?.timestampMs ?? claim?.timestampMs,
      evidenceIds: evidenceIdsFor(contradiction?.timestampMs ?? claim?.timestampMs),
      source: contradiction ? 'mixed' : 'speaker_claim',
      rootCause: null
    }
  }

  if (args.status === 'insufficient_evidence') {
    return {
      outcome: 'insufficient_evidence',
      title: 'Insufficient evidence',
      explanation: 'The recording does not establish a reconstructable visual failure.',
      evidenceIds: [],
      source: 'unknown',
      rootCause: null
    }
  }

  return {
    outcome: 'no_visual_failure',
    title: 'No visual failure confirmed',
    explanation:
      'Visible actions were reconstructed. No selected, entered, or other sticky state changed unless the action targeted that control.',
    evidenceIds: [],
    source: 'visible',
    rootCause: null
  }
}

function clipTitle(text: string): string {
  return text.length > 90 ? `${text.slice(0, 87)}…` : text
}

function buildSummary(args: {
  status: BugReport['status']
  startingConditions: EvidenceStatement[]
  steps: ReproductionStep[]
  visibleFailure: EvidenceStatement | null
  speakerClaims: EvidenceStatement[]
  primaryFinding: PrimaryFinding
}): string {
  if (args.primaryFinding.outcome === 'bug_detected') {
    return `${args.primaryFinding.explanation} Root cause: unknown.`
  }
  if (args.status === 'claimed_not_observed') {
    return `${args.primaryFinding.explanation} Root cause: unknown.`
  }
  if (args.status === 'no_failure_observed') {
    return `${args.primaryFinding.explanation} Root cause: unknown.`
  }
  return `${args.primaryFinding.explanation} Root cause: unknown.`
}

const UNKNOWN_BUCKETS: Array<{ re: RegExp; text: string }> = [
  { re: /source code|codebase|underlying (?:application )?code|application code|underlying code/i, text: 'Application source code was not provided.' },
  { re: /browser/i, text: 'Browser version was not visible.' },
  { re: /operating system|\bos\b/i, text: 'Operating system was not visible.' },
  { re: /\benvironment\b/i, text: 'Runtime environment was not visible.' },
  { re: /network/i, text: 'Network conditions were not visible.' },
  { re: /root cause/i, text: 'Technical root cause is unknown.' },
  { re: /reproduc/i, text: 'Whether the issue reproduces after reload is unknown.' }
]

const DEFAULT_UNKNOWNS = [
  'Browser version was not visible.',
  'Operating system was not visible.',
  'Network conditions were not visible.',
  'Application source code was not provided.',
  'Technical root cause is unknown.',
  'Whether the issue reproduces after reload is unknown.'
]

export function uniqueUnknowns(items: string[]): string[] {
  const usedBuckets = new Set<string>()
  const extras: string[] = []
  for (const item of [...DEFAULT_UNKNOWNS, ...items]) {
    const trimmed = item.trim()
    if (!trimmed) continue
    let bucketed = false
    for (const bucket of UNKNOWN_BUCKETS) {
      if (bucket.re.test(trimmed)) {
        usedBuckets.add(bucket.text)
        bucketed = true
      }
    }
    if (bucketed) continue
    extras.push(trimmed)
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const text of [...usedBuckets, ...extras]) {
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

function dedupeEvidence(items: EvidenceReference[]): EvidenceReference[] {
  const out: EvidenceReference[] = []
  for (const item of items) {
    const tokens = uniqueTokens(item.label)
    const dup = out.find((existing) => {
      if (Math.abs(existing.timestampMs - item.timestampMs) > 500) return false
      const other = uniqueTokens(existing.label)
      if (tokens.length === 0 || other.length === 0) return existing.label === item.label
      const overlap = tokens.filter((token) => other.includes(token)).length
      const shorter = Math.min(tokens.length, other.length)
      return overlap / shorter >= 0.7
    })
    if (dup) {
      if (item.label.length > dup.label.length) dup.label = item.label
      continue
    }
    out.push({ ...item })
  }
  return out.slice(0, 16)
}
