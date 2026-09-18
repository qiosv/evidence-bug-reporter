import type {
  StateChange,
  StateChangeRelation,
  StateObservation,
  StateProperty,
  VisualAction,
  VisualAnalysis,
  VisibleFailure
} from '../shared/types'

export function normKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function valuesEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tokens(text: string): string[] {
  const stop = new Set([
    'the',
    'a',
    'an',
    'of',
    'to',
    'on',
    'in',
    'for',
    'and',
    'name',
    'value',
    'field',
    'input',
    'button',
    'control',
    'label',
    'text',
    'item',
    'set'
  ])
  return normKey(text)
    .split(' ')
    .filter((t) => t.length > 1 && !stop.has(t))
}

function tokenOverlap(a: string, b: string): boolean {
  const left = tokens(a)
  const right = new Set(tokens(b))
  if (left.length === 0 || right.size === 0) return false
  const hit = left.filter((t) => right.has(t)).length
  return hit / Math.min(left.length, right.size) >= 0.5
}

function blob(kind?: string, name?: string, extra?: string): string {
  return `${kind ?? ''} ${name ?? ''} ${extra ?? ''}`
}

/** Established values the user set or that represent entered/selected UI, not list contents. */
export function isStickyState(kind?: string, name?: string): boolean {
  return /select|option|toggle|check|radio|switch|input|text_value|text value|form|field|cart|auth|login|sort|preferenc|setting|validat|enabled|visibility|method|status|urgency|priority|assignee|query|search|entered|typed/i.test(
    blob(kind, name)
  )
}

export function isNavigationState(kind?: string, name?: string, interaction?: string): boolean {
  return /\bnav|page|tab|route|step|wizard|next|previous|back button/i.test(blob(kind, name, interaction))
}

export function isContentState(kind?: string, name?: string): boolean {
  return /result|list|table|grid|item|feed|content|output|collection|rows/i.test(blob(kind, name))
}

/** Derived view chrome: result lists, pager position, counts — not independent entered/selected values. */
export function isDerivedViewState(kind?: string, name?: string): boolean {
  return (
    isContentState(kind, name) ||
    isNavigationState(kind, name) ||
    /count|total|showing|hits|\brows\b/i.test(blob(kind, name))
  )
}

function toMap(props: StateProperty[]): Map<string, StateProperty> {
  const map = new Map<string, StateProperty>()
  for (const prop of props) {
    const key = normKey(prop.name)
    if (!key) continue
    map.set(key, prop)
  }
  return map
}

export function disappeared(change: { before: string; after: string }): boolean {
  const after = change.after.trim()
  const before = change.before.trim()
  if (!before) return false
  if (!after) return true
  if (/^\(.*\)$/.test(after)) return true
  return /^(gone|hidden|absent|n\/a|none|empty|cleared|blank|placeholder)$/i.test(after)
}

function looksLikeError(change: StateChange): boolean {
  return /error|invalid|failed|failure|required|warning|blocked/i.test(
    `${change.after} ${change.kind ?? ''} ${change.name}`
  )
}

function interactionBlob(observation: StateObservation): string {
  return `${observation.interaction} ${observation.actedOn ?? ''} ${observation.actedOnKind ?? ''}`
}

/** True when the user clicked/selected/typed this visible value. */
export function interactionChoosesValue(observation: StateObservation, value: string): boolean {
  const raw = value.trim()
  if (!raw) return false
  if (observation.actedOn && valuesEqual(observation.actedOn, raw)) return true
  const needle = escapeRegExp(raw)
  const hay = interactionBlob(observation)
  const targeted = new RegExp(
    `\\b(click(?:s|ed|ing)?|select(?:s|ed|ing)?|chose|choose|pick(?:s|ed)?|toggle(?:s|d)?|check(?:s|ed)?|press(?:es|ed)?|type(?:s|d)?|enter(?:s|ed)?|fill(?:s|ed)?)\\b[\\s\\S]{0,48}\\b${needle}\\b|\\b${needle}\\b[\\s\\S]{0,24}\\b(click|button|chip|tab|option|filter|control|toggle)`,
    'i'
  )
  return targeted.test(hay)
}

function describesPassiveStateChange(observation: StateObservation): boolean {
  const hay = observation.interaction
  return (
    /\b(is|was|gets|got|became|becomes|appears? to have been)\s+(cleared|emptied|blank|empty|reset|changed)\b/i.test(
      hay
    ) || /\b(cleared|emptied)\s*\/\s*(emptied|cleared)\b/i.test(hay)
  )
}

function isUserDirectedAction(observation: StateObservation): boolean {
  const hay = interactionBlob(observation)
  if (
    /\b(automatic(?:ally)?|without [^.]*interaction|on its own|spontaneously|by itself)\b/i.test(hay)
  ) {
    return false
  }
  if (describesPassiveStateChange(observation) && !hasExplicitPointerVerb(observation)) {
    return false
  }
  return isPointerOrEditAction(observation) || isTypingOrClearing(observation)
}

function hasExplicitPointerVerb(observation: StateObservation): boolean {
  return /\b(click(?:s|ed|ing)?|select(?:s|ed|ing)?|chose|choose|pick(?:s|ed)?|toggle(?:s|d)?|check(?:s|ed)?|press(?:es|ed)?|tap(?:s|ped)?|type(?:s|d)?|enter(?:s|ed)?|fill(?:s|ed)?)\b/i.test(
    interactionBlob(observation)
  )
}

function isPointerOrEditAction(observation: StateObservation): boolean {
  return /\b(click(?:s|ed|ing)?|select(?:s|ed|ing)?|chose|choose|pick(?:s|ed)?|toggle(?:s|d)?|check(?:s|ed)?|type(?:s|d)?|enter(?:s|ed)?|press(?:es|ed)?|tap(?:s|ped)?|fill(?:s|ed)?|delete(?:s|d)?|backspace)\b/i.test(
    interactionBlob(observation)
  )
}

function isTypingOrClearing(observation: StateObservation): boolean {
  return (
    /\b(type(?:s|d)?|enter(?:s|ed)?|fill(?:s|ed)?|wrote|write|paste(?:d)?|delete(?:s|d)?|backspace|erase(?:s|d)?|remove(?:s|d)? text)\b/i.test(
      observation.interaction
    ) || /\bclear(?:s|ed)?\s+\S/i.test(observation.interaction)
  )
}

function targetsProperty(observation: StateObservation, prop: StateProperty): boolean {
  const acted = observation.actedOn ?? ''
  if (acted && valuesEqual(prop.value, acted)) return true
  if (acted && tokenOverlap(prop.name, acted)) return true
  if (acted && prop.kind && tokenOverlap(prop.kind, acted)) return true
  if (tokenOverlap(prop.name, observation.interaction) && !isContentState(prop.kind, prop.name)) {
    return true
  }
  if (
    isNavigationState(observation.actedOnKind, observation.actedOn, observation.interaction) &&
    isNavigationState(prop.kind, prop.name)
  ) {
    return true
  }
  return false
}

function targetedDifferentControl(change: StateChange, observation: StateObservation): boolean {
  if (interactionChoosesValue(observation, change.after)) return false
  if (interactionChoosesValue(observation, change.before) && isTypingOrClearing(observation)) {
    return false
  }
  const acted = observation.actedOn ?? ''
  if (acted && (tokenOverlap(change.name, acted) || valuesEqual(acted, change.after))) return false
  if (tokenOverlap(change.name, observation.interaction) && !isContentState(change.kind, change.name)) {
    return false
  }
  if (
    isNavigationState(observation.actedOnKind, observation.actedOn, observation.interaction) &&
    isNavigationState(change.kind, change.name)
  ) {
    return false
  }
  return Boolean(acted || observation.interaction)
}

function isConsequentialContent(change: StateChange, observation: StateObservation): boolean {
  if (!isContentState(change.kind, change.name)) return false
  if (!isUserDirectedAction(observation)) return false
  return (
    isNavigationState(observation.actedOnKind, observation.actedOn, observation.interaction) ||
    isStickyState(observation.actedOnKind, observation.actedOn) ||
    isPointerOrEditAction(observation)
  )
}

/** True when the action changes a discrete selected/typed constraint, not a view-position control. */
function isConstraintAction(observation: StateObservation): boolean {
  if (!isUserDirectedAction(observation)) return false
  const acted = observation.actedOn ?? ''
  const navAction = isNavigationState(observation.actedOnKind, acted, observation.interaction)
  if (navAction && !isStickyState(observation.actedOnKind, acted)) return false
  if (isStickyState(observation.actedOnKind, acted)) return true
  if (!acted || !isPointerOrEditAction(observation) || navAction) return false
  return interactionChoosesValue(observation, acted)
}

function isReasonableConsequence(
  change: StateChange,
  observation: StateObservation,
  directs: Array<Omit<StateChange, 'relation'>>
): boolean {
  if (isMirrorOf(change, directs as StateChange[])) return true
  if (isConsequentialContent(change, observation)) return true
  if (isDerivedViewState(change.kind, change.name) && isConstraintAction(observation)) return true
  return false
}

function isMirrorOf(
  change: StateChange,
  directs: StateChange[]
): boolean {
  return directs.some(
    (direct) =>
      valuesEqual(direct.before, change.before) &&
      valuesEqual(direct.after, change.after) &&
      !valuesEqual(direct.name, change.name)
  )
}

export function classifyRelation(
  change: Omit<StateChange, 'relation'>,
  observation: StateObservation,
  directs: Array<Omit<StateChange, 'relation'>> = []
): StateChangeRelation {
  const asChange = { ...change, relation: 'unknown_relation' as const }
  if (interactionChoosesValue(observation, change.after)) {
    return 'direct_effect'
  }
  if (
    isUserDirectedAction(observation) &&
    (targetsProperty(observation, { name: change.name, value: change.after, kind: change.kind }) ||
      targetsProperty(observation, { name: change.name, value: change.before, kind: change.kind }))
  ) {
    return 'direct_effect'
  }
  if (isReasonableConsequence(asChange, observation, directs)) {
    return 'secondary_effect'
  }
  const independentPersistent =
    ((isStickyState(change.kind, change.name) && !isDerivedViewState(change.kind, change.name)) ||
      disappeared(change)) &&
    targetedDifferentControl(asChange, observation)
  if (independentPersistent) {
    return 'unrelated_change'
  }
  if (disappeared(change) && !isUserDirectedAction(observation)) {
    return 'unrelated_change'
  }
  return 'unknown_relation'
}

export interface FailureCandidate {
  timestampMs: number
  change: StateChange
  observation: StateObservation
  score: number
  description: string
  title: string
  explanation: string
  preState: string
  action: string
  postState: string
  confidence?: number
  establishedBefore: boolean
}

function noVisibleActionRequestsState(change: StateChange, observation: StateObservation): boolean {
  const after = change.after.trim()
  if (!after || disappeared(change)) return true
  if (interactionChoosesValue(observation, after)) return false
  const hay = interactionBlob(observation).toLowerCase()
  return !hay.includes(after.toLowerCase())
}

export function relationPriority(relation: StateChangeRelation): number {
  if (relation === 'unrelated_change') return 3
  if (relation === 'unknown_relation') return 2
  if (relation === 'secondary_effect') return 1
  return 0
}

export function scoreFailureCandidate(
  change: StateChange,
  observation: StateObservation,
  establishedBefore: boolean,
  corroborating = 0
): number {
  if (change.relation === 'direct_effect') return -1000
  if (change.relation === 'secondary_effect') return -1000
  if (change.relation === 'unknown_relation' && isDerivedViewState(change.kind, change.name)) {
    return -1000
  }
  let score = relationPriority(change.relation) * 10
  if (change.relation === 'unrelated_change') score += 8
  if (establishedBefore) score += 2
  if (targetedDifferentControl(change, observation)) score += 3
  if (noVisibleActionRequestsState(change, observation)) score += 2
  if (looksLikeError(change)) score += 3
  if (disappeared(change) && isStickyState(change.kind, change.name)) score += 3
  else if (disappeared(change)) score += 2
  if (isStickyState(change.kind, change.name) && !isDerivedViewState(change.kind, change.name)) score += 2
  if ((observation.confidence ?? 0) >= 0.8) score += 1
  if (corroborating > 0) score += Math.min(3, corroborating)
  return score
}

const SCORE_THRESHOLD = 5

export function isFailureWorthy(score: number): boolean {
  return score >= SCORE_THRESHOLD
}

function contradictionDeniesChange(visual: VisualAnalysis, change: StateChange): boolean {
  return (visual.speakerVisualContradictions ?? []).some((row) => {
    const evidence = row.visibleEvidence
    const denies =
      /\b(remain(?:ed|s)|still|did not|doesn't|does not|unchanged|stayed|no reset)\b/i.test(evidence)
    if (!denies) return false
    return (
      evidence.toLowerCase().includes(change.before.toLowerCase()) ||
      evidence.toLowerCase().includes(change.name.toLowerCase())
    )
  })
}

function describeChanges(changes: StateChange[]): string {
  const fmt = (items: StateChange[]): string =>
    items.map((c) => `${c.name} "${c.before}" → "${c.after}"`).join('; ')
  const parts: string[] = []
  const direct = changes.filter((c) => c.relation === 'direct_effect')
  const secondary = changes.filter((c) => c.relation === 'secondary_effect')
  const unrelated = changes.filter((c) => c.relation === 'unrelated_change')
  const unknown = changes.filter((c) => c.relation === 'unknown_relation')
  if (direct.length) parts.push(`Direct effect: ${fmt(direct)}.`)
  if (secondary.length) parts.push(`Secondary effect: ${fmt(secondary)}.`)
  if (unrelated.length) parts.push(`Unrelated change: ${fmt(unrelated)}.`)
  if (unknown.length) parts.push(`Unclassified change: ${fmt(unknown)}.`)
  return parts.join(' ')
}

function anomalyDescription(change: StateChange, observation: StateObservation): string {
  return `The visible value of "${change.name}" changed from "${change.before}" to "${change.after}" after "${observation.interaction}" without a visible action requesting that state.`
}

function candidateTitle(change: StateChange): string {
  if (disappeared(change)) {
    return `"${change.name}" disappeared after another control was used`
  }
  return `"${change.name}" changed from "${change.before}" to "${change.after}"`
}

function candidateExplanation(change: StateChange, observation: StateObservation): string {
  const targeted = observation.actedOn ? ` "${observation.actedOn}"` : ''
  return `After ${observation.interaction}${targeted ? ` on${targeted}` : ''}, "${change.name}" went from "${change.before}" to "${change.after}". That control was not the one the action targeted.`
}

function diffObservation(
  established: Map<string, StateProperty>,
  observation: StateObservation
): { beforeMap: Map<string, StateProperty>; afterProps: StateProperty[]; changes: StateChange[] } {
  const beforeMap = new Map(established)
  for (const prop of observation.stateBefore ?? []) {
    const key = normKey(prop.name)
    if (!key) continue
    if (!beforeMap.has(key)) beforeMap.set(key, prop)
  }

  const explicitAfter = toMap(observation.stateAfter ?? [])
  const afterProps: StateProperty[] = []
  const seen = new Set<string>()
  for (const [key, afterProp] of explicitAfter) {
    seen.add(key)
    afterProps.push(afterProp)
  }
  for (const [key, beforeProp] of beforeMap) {
    if (seen.has(key)) continue
    if (!isStickyState(beforeProp.kind, beforeProp.name)) continue
    afterProps.push(beforeProp)
    seen.add(key)
  }

  const afterMap = toMap(afterProps)
  const pending: Array<Omit<StateChange, 'relation'>> = []
  for (const [key, afterProp] of afterMap) {
    const beforeProp = beforeMap.get(key)
    if (!beforeProp || valuesEqual(beforeProp.value, afterProp.value)) continue
    pending.push({
      name: afterProp.name || beforeProp.name,
      before: beforeProp.value,
      after: afterProp.value,
      kind: afterProp.kind || beforeProp.kind
    })
  }

  const directs = pending.filter((change) => classifyRelation(change, observation) === 'direct_effect')
  const changes: StateChange[] = pending.map((change) => ({
    ...change,
    relation: classifyRelation(change, observation, directs)
  }))

  return { beforeMap, afterProps, changes }
}

function carryForward(
  established: Map<string, StateProperty>,
  afterProps: StateProperty[]
): void {
  for (const prop of afterProps) {
    const key = normKey(prop.name)
    if (key) established.set(key, prop)
  }
}

function upsertAction(actions: VisualAction[], observation: StateObservation, summary: string): void {
  const existing = actions.find((action) => Math.abs(action.timestampMs - observation.timestampMs) < 500)
  const context = observation.context ? `${observation.context}. ` : ''
  const body = `${context}${observation.interaction}${summary ? ` ${summary}` : ''}`.trim()
  if (existing) {
    if (summary && !/direct effect:|unrelated change:/i.test(existing.description)) {
      existing.description = `${existing.description} ${summary}`.trim()
    }
    existing.type = existing.type === 'screen_state' ? 'user_action' : existing.type
    return
  }
  actions.push({
    timestampMs: observation.timestampMs,
    description: body,
    type: 'user_action'
  })
}

function sameTransition(a: StateChange, b: StateChange): boolean {
  return valuesEqual(a.before, b.before) && valuesEqual(a.after, b.after)
}

export function collectFailureCandidates(
  observations: StateObservation[],
  visual: VisualAnalysis,
  establishedNames: Set<string>
): FailureCandidate[] {
  const raw: FailureCandidate[] = []
  const established = new Set(establishedNames)

  for (const observation of observations) {
    const changes = observation.changedState ?? []
    for (const change of changes) {
      if (contradictionDeniesChange(visual, change)) continue
      const establishedBefore = established.has(normKey(change.name))
      const corroborating = changes.filter(
        (other) => other !== change && other.relation !== 'direct_effect' && sameTransition(change, other)
      ).length
      const score = scoreFailureCandidate(change, observation, establishedBefore, corroborating)
      if (change.relation === 'direct_effect' || change.relation === 'secondary_effect') continue
      if (!isFailureWorthy(score)) continue
      raw.push({
        timestampMs: observation.timestampMs,
        change,
        observation,
        score,
        description: anomalyDescription(change, observation),
        title: candidateTitle(change),
        explanation: candidateExplanation(change, observation),
        preState: `${change.name}: ${change.before}`,
        action: observation.interaction,
        postState: `${change.name}: ${change.after}`,
        confidence: observation.confidence,
        establishedBefore
      })
    }
    for (const prop of observation.stateAfter ?? []) {
      const key = normKey(prop.name)
      if (key) established.add(key)
    }
  }

  const byRank = (a: FailureCandidate, b: FailureCandidate): number =>
    relationPriority(b.change.relation) - relationPriority(a.change.relation) ||
    b.score - a.score ||
    a.timestampMs - b.timestampMs

  raw.sort(byRank)
  const merged: FailureCandidate[] = []
  for (const candidate of raw) {
    const alias = merged.find(
      (item) =>
        Math.abs(item.timestampMs - candidate.timestampMs) < 800 &&
        sameTransition(item.change, candidate.change)
    )
    if (alias) {
      alias.score = Math.max(alias.score, candidate.score + 1)
      continue
    }
    merged.push(candidate)
  }
  merged.sort(byRank)
  return merged
}

function describesDirectEffect(failure: VisibleFailure, observations: StateObservation[]): boolean {
  return observations.some((observation) => {
    if (Math.abs(observation.timestampMs - failure.timestampMs) > 1500) return false
    return (observation.changedState ?? []).some((change) => {
      if (change.relation !== 'direct_effect') return false
      const text = failure.description.toLowerCase()
      return (
        text.includes(change.name.toLowerCase()) &&
        (text.includes(change.before.toLowerCase()) || text.includes(change.after.toLowerCase()))
      )
    })
  })
}

/**
 * Reconstruct temporal UI state from structured observations.
 * Compares the full established state against each post-action snapshot.
 * Does not assume any particular application widgets.
 */
export function applyTemporalContinuity(visual: VisualAnalysis): VisualAnalysis {
  const established = toMap(visual.startingState ?? [])
  const establishedNames = new Set(established.keys())
  const observations: StateObservation[] = (visual.stateObservations ?? []).map((row) => ({
    ...row,
    stateBefore: [...(row.stateBefore ?? [])],
    stateAfter: [...(row.stateAfter ?? [])]
  }))
  const actions: VisualAction[] = visual.visibleActions.map((action) => ({ ...action }))

  for (const observation of observations) {
    const { beforeMap, afterProps, changes } = diffObservation(established, observation)
    observation.stateBefore = [...beforeMap.values()]
    observation.stateAfter = afterProps
    observation.changedState = changes
    carryForward(established, afterProps)

    const summary = describeChanges(changes)
    upsertAction(actions, observation, summary)
  }

  const candidates = collectFailureCandidates(observations, visual, establishedNames)
  const fromTracking: VisibleFailure[] = candidates.map((candidate) => ({
    timestampMs: candidate.timestampMs,
    description: candidate.description
  }))
  const keptGemini = visual.visibleFailures.filter(
    (failure) => !describesDirectEffect(failure, observations)
  )

  return {
    ...visual,
    startingState: visual.startingState ?? [],
    stateObservations: observations,
    visibleActions: dedupeActions(actions),
    visibleFailures: fromTracking.length > 0 ? fromTracking : keptGemini
  }
}

function dedupeActions(actions: VisualAction[]): VisualAction[] {
  const sorted = [...actions].sort((a, b) => a.timestampMs - b.timestampMs)
  const out: VisualAction[] = []
  for (const action of sorted) {
    const prev = out[out.length - 1]
    if (prev && Math.abs(prev.timestampMs - action.timestampMs) < 500) {
      const prevKey = normKey(prev.description)
      const nextKey = normKey(action.description)
      if (prevKey.includes(nextKey) || nextKey.includes(prevKey) || tokenOverlap(prev.description, action.description)) {
        if (action.description.length > prev.description.length) prev.description = action.description
        continue
      }
    }
    out.push({ ...action })
  }
  return out
}
