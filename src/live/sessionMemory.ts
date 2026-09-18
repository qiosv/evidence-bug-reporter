import type { EvidenceSource } from '../shared/types'

const FAILURE_CLAIM =
  /\b(reset|broke|broken|bug|fail(?:ed|ure)?|wrong|didn't|did not|doesn't|does not|not working|went back|reverted|lost|missing)\b/i

export type VerificationState =
  | 'none'
  | 'unverified'
  | 'verified_against_path'
  | 'appeared_after_change'

export interface SessionMemoryEntry {
  id: string
  timestampMs: number
  source: EvidenceSource
  visibleState?: string
  speakerStatement?: string
  detectedIssue?: string
  verificationState: VerificationState
  changeId?: string
}

export interface LiveIssue {
  timestampMs: number
  text: string
  source: EvidenceSource
  verificationState: VerificationState
  afterChangeId?: string
}

export interface SessionMemory {
  startedAtMs: number
  changes: Array<{ id: string; timestampMs: number; description: string }>
  entries: SessionMemoryEntry[]
  issues: LiveIssue[]
}

export function createSessionMemory(startedAtMs: number): SessionMemory {
  return { startedAtMs, changes: [], entries: [], issues: [] }
}

export function rememberVisibleChange(
  memory: SessionMemory,
  args: { id: string; timestampMs: number; description: string }
): SessionMemory {
  const changeId = `Change ${memory.changes.length + 1}`
  const entry: SessionMemoryEntry = {
    id: args.id,
    timestampMs: args.timestampMs,
    source: 'visible',
    visibleState: args.description,
    verificationState: 'none',
    changeId
  }
  return {
    ...memory,
    changes: [...memory.changes, { id: changeId, timestampMs: args.timestampMs, description: args.description }],
    entries: [...memory.entries, entry]
  }
}

export function rememberSpeaker(
  memory: SessionMemory,
  args: { id: string; timestampMs: number; text: string }
): SessionMemory {
  const recent = [...memory.changes].reverse().find((c) => args.timestampMs - c.timestampMs <= 6000)
  const claimsFailure = FAILURE_CLAIM.test(args.text)
  let detectedIssue: string | undefined
  let verificationState: VerificationState = 'none'

  if (claimsFailure && recent) {
    detectedIssue = `Speaker claimed “${args.text}” near ${recent.id}. A screen change was sampled around then. This is a candidate, not a proven cause, and it is not treated as visible proof.`
    verificationState = 'unverified'
  } else if (claimsFailure) {
    detectedIssue =
      'Speaker claimed a failure that was not observed in sampled frames at that moment. Speaker evidence only — not visible.'
    verificationState = 'unverified'
  } else if (recent && memory.issues.some((i) => i.verificationState === 'unverified')) {
    detectedIssue = `Additional speech arrived after ${recent.id}. If a new problem is visible, it appeared after ${recent.id} — not established as caused by it.`
    verificationState = 'appeared_after_change'
  }

  const entry: SessionMemoryEntry = {
    id: args.id,
    timestampMs: args.timestampMs,
    source: 'speaker_claim',
    speakerStatement: args.text,
    detectedIssue,
    verificationState,
    changeId: recent?.id
  }
  const issues = detectedIssue
    ? [
        ...memory.issues,
        {
          timestampMs: args.timestampMs,
          text: detectedIssue,
          source: 'speaker_claim' as const,
          verificationState,
          afterChangeId: recent?.id
        }
      ]
    : memory.issues
  return { ...memory, entries: [...memory.entries, entry], issues }
}

export function markVerifiedAgainstPath(memory: SessionMemory, changeId: string, timestampMs: number): SessionMemory {
  const match = memory.issues.find((i) => i.afterChangeId === changeId || i.text.includes(changeId))
  if (!match) return memory
  const issue: LiveIssue = {
    timestampMs,
    text: `Later behavior was verified against the reproduction path involving ${changeId}.`,
    source: 'visible',
    verificationState: 'verified_against_path',
    afterChangeId: changeId
  }
  return { ...memory, issues: [...memory.issues, issue] }
}
