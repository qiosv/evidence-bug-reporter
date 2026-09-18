export type EvidenceSource = 'visible' | 'speaker_claim' | 'unknown'

export type EvidenceEventType =
  | 'screen_state'
  | 'user_action'
  | 'speaker_statement'
  | 'failure'
  | 'change'
  | 'verification'
  | 'unknown'

export interface EvidenceEvent {
  id: string
  timestampMs: number
  type: EvidenceEventType
  source: EvidenceSource
  description: string
  confidence?: number
  frameTimestampMs?: number
  metadata?: Record<string, unknown>
}

export interface TranscriptSegment {
  startMs: number
  endMs: number
  text: string
}

export interface EvidenceStatement {
  text: string
  source: EvidenceSource
  timestampMs?: number
  established: boolean
}

export interface ReproductionStep {
  index: number
  description: string
  timestampMs?: number
  source: EvidenceSource
  frameTimestampMs?: number
}

export interface EvidenceReference {
  id: string
  timestampMs: number
  source: EvidenceSource
  label: string
}

export type BugReportStatus =
  | 'confirmed'
  | 'claimed_not_observed'
  | 'insufficient_evidence'
  | 'no_failure_observed'

export interface BugReport {
  title: string
  status: BugReportStatus
  primaryFinding: PrimaryFinding
  startingConditions: EvidenceStatement[]
  steps: ReproductionStep[]
  observedFailure?: EvidenceStatement | null
  speakerClaims: EvidenceStatement[]
  expectedBehavior: {
    value: string | null
    established: boolean
    source?: string
  }
  unknowns: string[]
  summary: string
  evidence: EvidenceReference[]
}

export interface VisualAction {
  timestampMs: number
  description: string
  type: Exclude<EvidenceEventType, 'speaker_statement'>
}

export interface VisibleFailure {
  timestampMs: number
  description: string
}

export interface SpeakerVisualContradiction {
  timestampMs: number
  speakerClaim: string
  visibleEvidence: string
}

/** Dynamically named visible UI property. Names come from the recording, not a fixed app schema. */
export interface StateProperty {
  name: string
  value: string
  kind?: string
}

export type StateChangeRelation =
  | 'direct_effect'
  | 'secondary_effect'
  | 'unrelated_change'
  | 'unknown_relation'

export interface StateChange {
  name: string
  before: string
  after: string
  kind?: string
  relation: StateChangeRelation
}

export type PrimaryFindingOutcome =
  | 'bug_detected'
  | 'no_visual_failure'
  | 'claimed_not_observed'
  | 'insufficient_evidence'

export interface PrimaryFinding {
  outcome: PrimaryFindingOutcome
  title: string
  explanation: string
  preState?: string
  action?: string
  postState?: string
  timestampMs?: number
  evidenceIds: string[]
  source: EvidenceSource | 'mixed'
  rootCause: string | null
  confidence?: number
}

/** One meaningful action with before/after UI state reconstructed from nearby frames. */
export interface StateObservation {
  timestampMs: number
  context?: string
  interaction: string
  actedOn?: string
  actedOnKind?: string
  stateBefore: StateProperty[]
  stateAfter: StateProperty[]
  changedState?: StateChange[]
  visibleEvidence?: string
  confidence?: number
}

export interface VisualAnalysis {
  startingConditions: Array<{ timestampMs: number; description: string }>
  startingState?: StateProperty[]
  stateObservations?: StateObservation[]
  visibleActions: VisualAction[]
  visibleFailures: VisibleFailure[]
  speakerVisualContradictions: SpeakerVisualContradiction[]
  expectedBehaviorFromUi: {
    value: string | null
    established: boolean
    source?: string
  }
  unknowns: string[]
}

export interface VideoMetadata {
  durationMs: number
  hasAudio: boolean
  width?: number
  height?: number
  mimeType: string
}

export type WorkflowPhase =
  | 'idle'
  | 'validating'
  | 'transcribing'
  | 'analyzing_video'
  | 'generating_report'
  | 'ready'
  | 'error'

export interface PhaseTimings {
  /** Time spent reading/validating the uploaded file (not a separate upload protocol). */
  uploadMs: number
  validationMs: number
  transcriptionMs: number
  videoAnalysisMs: number
  reportGenerationMs: number
  totalMs: number
  /** Report is produced only at the end of the pipeline, so this equals totalMs. */
  timeToUsefulResultMs: number
}

export interface UsageMetrics {
  aiCallCount: number
  retryCount: number
  inputTokens: number | null
  outputTokens: number | null
  retryInputTokens: number
  retryOutputTokens: number
  cachedInputTokens?: number | null
  audioDurationMs: number
  videoDurationMs: number
  segmentCount: number
  sttProvider?: 'xai' | 'groq'
  sttModel: string
  geminiModel: string
  geminiDelivery: 'inline' | 'files_api' | 'none'
}

export interface CostBreakdown {
  currency: 'USD'
  sttUsd: number
  videoInputUsd: number
  modelOutputUsd: number
  retryUsd: number
  totalVariableUsd: number
  hostingNote: string
  assumptions: {
    groqWhisperUsdPerHour: number
    sttUsdPerHour?: number
    sttProvider?: string
    geminiInputUsdPerMillion: number
    geminiOutputUsdPerMillion: number
    geminiModel: string
    groqModel: string
  }
}

export interface AnalysisMetrics {
  timings: PhaseTimings
  usage: UsageMetrics
  cost: CostBreakdown
}

export interface AnalyzeSuccess {
  report: BugReport
  events: EvidenceEvent[]
  transcript: TranscriptSegment[]
  visual: VisualAnalysis
  metrics: AnalysisMetrics
}

export type AnalysisCategory =
  | 'functional'
  | 'visual'
  | 'seo'
  | 'accessibility'
  | 'code'
  | 'console'
  | 'content'

/** Future inspector payloads — not populated in the MP4 MVP. */
export interface CodeContext {
  files?: Array<{ path: string; content: string }>
}

export interface ConsoleContext {
  messages?: Array<{ level: string; text: string; timestampMs?: number }>
}

export interface DOMContext {
  html?: string
  url?: string
}

export interface FutureFinding {
  category: AnalysisCategory
  severity: 'info' | 'warning' | 'error'
  file?: string
  line?: number
  snippet?: string
  finding: string
  whyItMatters: string
  suggestedFix?: string
  verificationStatus: 'unverified' | 'supported_by_visible_evidence' | 'unsupported'
  source: EvidenceSource
}

export interface SessionState {
  events: EvidenceEvent[]
  currentIssue?: IssueState
  previousIssues: IssueState[]
  changes: ChangeRecord[]
  transcript: TranscriptSegment[]
  lastScreenState?: ScreenState
}

export interface IssueState {
  id: string
  title: string
  status: BugReportStatus
  category: AnalysisCategory
  description: string
}

export interface ChangeRecord {
  id: string
  timestampMs: number
  before: string
  change: string
  after: string
  claimedIntent?: string
  verificationResult?: string
  /** Temporal relationship only; do not imply causation unless evidence proves it. */
  appearedAfterChange?: boolean
}

export interface ScreenState {
  timestampMs: number
  description: string
}

export interface GroundTruthFixture {
  id: 'test-a' | 'test-b' | 'test-c'
  title: string
  status: BugReportStatus
  essentialVisibleSteps: string[]
  speakerClaims: string[]
  observedFailure: string | null
  unknownsInclude?: string[]
}
