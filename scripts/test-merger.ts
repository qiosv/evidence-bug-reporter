import { mergeEvidence } from '../src/analysis/evidenceMerger'
import type { VisualAnalysis, TranscriptSegment } from '../src/shared/types'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const start: VisualAnalysis['startingConditions'] = [
  { timestampMs: 200, description: 'Catalog open. Status filter All. Page 1.' }
]

const silentActions: VisualAnalysis['visibleActions'] = [
  { timestampMs: 2500, description: 'Status filter changed from All to Active', type: 'user_action' },
  { timestampMs: 5500, description: 'Clicked Page 2', type: 'user_action' },
  { timestampMs: 7000, description: 'Status filter changed from Active to All', type: 'change' }
]

const confirmedVisual: VisualAnalysis = {
  startingConditions: start,
  visibleActions: silentActions,
  visibleFailures: [
    { timestampMs: 7000, description: 'Status filter reset to All after opening page 2' }
  ],
  speakerVisualContradictions: [],
  expectedBehaviorFromUi: { value: null, established: false },
  unknowns: ['Root cause is unknown']
}

const claimedVisual: VisualAnalysis = {
  startingConditions: start,
  visibleActions: [
    { timestampMs: 2500, description: 'Status filter changed from All to Active', type: 'user_action' },
    { timestampMs: 5500, description: 'Clicked Page 2', type: 'user_action' },
    { timestampMs: 7000, description: 'Status filter remained Active. Page 2 shows Active products.', type: 'change' }
  ],
  visibleFailures: [],
  speakerVisualContradictions: [
    {
      timestampMs: 8000,
      speakerClaim: 'The filter reset',
      visibleEvidence: 'Selected filter still reads Active'
    }
  ],
  expectedBehaviorFromUi: { value: null, established: false },
  unknowns: []
}

const aTranscript: TranscriptSegment[] = [
  { startMs: 0, endMs: 2500, text: 'The catalog is open. Status filter is All.' },
  { startMs: 2500, endMs: 6000, text: 'I am changing the status filter to Active.' },
  { startMs: 6000, endMs: 11000, text: 'Now I click page two. The filter reset.' }
]

const bTranscript: TranscriptSegment[] = [
  { startMs: 0, endMs: 2500, text: 'I will reproduce the issue.' },
  { startMs: 8500, endMs: 11000, text: 'The filter reset.' }
]

const cTranscript: TranscriptSegment[] = [
  { startMs: 8000, endMs: 11000, text: 'The filter reset.' }
]

const a = mergeEvidence({ transcript: aTranscript, visual: confirmedVisual, videoDurationMs: 12000 })
assert(a.report.status === 'confirmed', `A status ${a.report.status}`)
assert(a.report.primaryFinding.outcome === 'bug_detected', `A primary ${a.report.primaryFinding.outcome}`)
assert(a.report.steps.some((s) => /Active/i.test(s.description)), 'A missing Active step')
assert(a.report.observedFailure?.source === 'visible', 'A failure must be visible')

const b = mergeEvidence({ transcript: bTranscript, visual: confirmedVisual, videoDurationMs: 12000 })
assert(b.report.status === 'confirmed', `B status ${b.report.status}`)
assert(
  b.report.steps.some((s) => /Active/i.test(s.description)) &&
    b.report.steps.some((s) => /page 2/i.test(s.description)),
  'B must recover silent visible actions'
)
assert(
  b.report.speakerClaims.some((c) => /reproduce/i.test(c.text)),
  'B should keep speaker claims separate'
)

const c = mergeEvidence({ transcript: cTranscript, visual: claimedVisual, videoDurationMs: 12000 })
assert(c.report.status === 'claimed_not_observed', `C status ${c.report.status}`)
assert(c.report.primaryFinding.outcome === 'claimed_not_observed', `C primary ${c.report.primaryFinding.outcome}`)
assert(!c.report.observedFailure?.established, 'C must not establish a visual failure')
assert(c.report.speakerClaims.some((s) => /reset/i.test(s.text)), 'C speaker claim missing')
assert(
  c.report.steps.some((s) => /remained Active|still|Active/i.test(s.description)),
  'C visible Active state missing'
)

const genericWordOverlap: VisualAnalysis = {
  ...confirmedVisual,
  speakerVisualContradictions: [
    {
      timestampMs: 10000,
      speakerClaim: 'Only active products are shown.',
      visibleEvidence: 'Page 2 shows All with inactive products'
    }
  ]
}
const overlap = mergeEvidence({
  transcript: aTranscript,
  visual: genericWordOverlap,
  videoDurationMs: 12000
})
assert(overlap.report.status === 'confirmed', `overlap status ${overlap.report.status}`)
assert(overlap.report.observedFailure?.source === 'visible', 'generic word overlap must not drop a visible failure')

const silentDefectInAction: VisualAnalysis = {
  startingConditions: start,
  visibleActions: [
    { timestampMs: 2500, description: 'Status filter changed from All to Active', type: 'user_action' },
    {
      timestampMs: 7000,
      description: 'Clicked Page 2; selected filter reverts back to All',
      type: 'change'
    }
  ],
  visibleFailures: [],
  speakerVisualContradictions: [
    {
      timestampMs: 8500,
      speakerClaim: 'the filter reset',
      visibleEvidence: 'Selected filter reverted to All after Page 2'
    }
  ],
  expectedBehaviorFromUi: { value: null, established: false },
  unknowns: []
}
const inferred = mergeEvidence({
  transcript: bTranscript,
  visual: silentDefectInAction,
  videoDurationMs: 12000
})
assert(inferred.report.status === 'confirmed', `inferred visible defect status ${inferred.report.status}`)
assert(inferred.report.observedFailure?.source === 'visible', 'action defect language must become visible failure')

const hallucinated: VisualAnalysis = {
  ...claimedVisual,
  visibleFailures: [{ timestampMs: 8000, description: 'The filter reset' }]
}
const c2 = mergeEvidence({ transcript: cTranscript, visual: hallucinated, videoDurationMs: 12000 })
assert(c2.report.status === 'claimed_not_observed', `C hallucinated failure status ${c2.report.status}`)
assert(!c2.report.observedFailure?.established, 'Contradiction must drop claim-only visibleFailures')

const checkoutStart = [{ timestampMs: 0, description: 'Checkout. Payment method Card. Step 1 of 2.' }]
const structuredSecondary: VisualAnalysis = {
  startingConditions: checkoutStart,
  startingState: [
    { name: 'payment method', value: 'Card', kind: 'selection' },
    { name: 'checkout step', value: '1', kind: 'navigation' }
  ],
  stateObservations: [
    {
      timestampMs: 4000,
      context: 'Checkout wizard',
      interaction: 'clicked Continue',
      actedOn: 'Continue button',
      actedOnKind: 'navigation',
      stateBefore: [
        { name: 'payment method', value: 'Card', kind: 'selection' },
        { name: 'checkout step', value: '1', kind: 'navigation' }
      ],
      stateAfter: [
        { name: 'payment method', value: 'Invoice', kind: 'selection' },
        { name: 'checkout step', value: '2', kind: 'navigation' }
      ],
      visibleEvidence: 'Step 2 is shown and Invoice is highlighted',
      confidence: 0.92
    }
  ],
  visibleActions: [{ timestampMs: 4000, description: 'Clicked Continue', type: 'user_action' }],
  visibleFailures: [],
  speakerVisualContradictions: [],
  expectedBehaviorFromUi: { value: null, established: false },
  unknowns: []
}
const structured = mergeEvidence({
  transcript: [],
  visual: structuredSecondary,
  videoDurationMs: 8000
})
assert(structured.report.status === 'confirmed', `structured secondary status ${structured.report.status}`)
assert(structured.report.primaryFinding.outcome === 'bug_detected', 'structured primary must be bug_detected')
assert(
  /Card/i.test(structured.report.primaryFinding.preState ?? '') &&
    /Continue/i.test(structured.report.primaryFinding.action ?? '') &&
    /Invoice/i.test(structured.report.primaryFinding.postState ?? ''),
  'primary finding must show pre-state → action → post-state'
)
assert(
  structured.report.observedFailure?.source === 'visible' &&
    /payment method/i.test(structured.report.observedFailure.text) &&
    /Card/i.test(structured.report.observedFailure.text) &&
    /Invoice/i.test(structured.report.observedFailure.text),
  'secondary selection change must become an evidence-backed failure'
)
assert(
  !structured.report.expectedBehavior.established,
  'must not invent expected behavior from a visible transition'
)

const structuredHealthy: VisualAnalysis = {
  ...structuredSecondary,
  stateObservations: [
    {
      ...structuredSecondary.stateObservations![0],
      stateAfter: [
        { name: 'payment method', value: 'Card', kind: 'selection' },
        { name: 'checkout step', value: '2', kind: 'navigation' }
      ],
      visibleEvidence: 'Step 2 is shown and Card remains highlighted'
    }
  ]
}
const healthy = mergeEvidence({
  transcript: [],
  visual: structuredHealthy,
  videoDurationMs: 8000
})
assert(
  healthy.report.status === 'no_failure_observed',
  `healthy checkout status ${healthy.report.status}`
)
assert(healthy.report.primaryFinding.outcome === 'no_visual_failure', 'healthy primary')
assert(!healthy.report.observedFailure?.established, 'healthy flow must not manufacture a failure')

const formDisappear: VisualAnalysis = {
  startingConditions: [{ timestampMs: 0, description: 'Desk request form. Name Sam Rivera. Urgency Normal.' }],
  startingState: [
    { name: 'requester name', value: 'Sam Rivera', kind: 'text_value' },
    { name: 'urgency', value: 'Normal', kind: 'selection' }
  ],
  stateObservations: [
    {
      timestampMs: 3500,
      context: 'Desk request form',
      interaction: 'clicked Urgent',
      actedOn: 'urgency',
      actedOnKind: 'selection',
      stateBefore: [
        { name: 'requester name', value: 'Sam Rivera', kind: 'text_value' },
        { name: 'urgency', value: 'Normal', kind: 'selection' }
      ],
      stateAfter: [
        { name: 'requester name', value: '', kind: 'text_value' },
        { name: 'urgency', value: 'Urgent', kind: 'selection' }
      ],
      visibleEvidence: 'Urgent is selected and the name field is empty',
      confidence: 0.9
    }
  ],
  visibleActions: [{ timestampMs: 3500, description: 'Clicked Urgent', type: 'user_action' }],
  visibleFailures: [],
  speakerVisualContradictions: [],
  expectedBehaviorFromUi: { value: null, established: false },
  unknowns: []
}
const formBug = mergeEvidence({ transcript: [], visual: formDisappear, videoDurationMs: 7000 })
assert(formBug.report.status === 'confirmed', `form disappear status ${formBug.report.status}`)
assert(
  formBug.report.observedFailure?.source === 'visible' &&
    /requester name/i.test(formBug.report.observedFailure.text) &&
    /Sam Rivera/i.test(formBug.report.observedFailure.text),
  'entered text disappearing after another control is used must be recovered'
)

const formOkVisual: VisualAnalysis = {
  ...formDisappear,
  stateObservations: [
    {
      ...formDisappear.stateObservations![0],
      stateAfter: [
        { name: 'requester name', value: 'Sam Rivera', kind: 'text_value' },
        { name: 'urgency', value: 'Urgent', kind: 'selection' }
      ],
      visibleEvidence: 'Urgent is selected and the name field still shows Sam Rivera'
    }
  ]
}
const formOk = mergeEvidence({ transcript: [], visual: formOkVisual, videoDurationMs: 7000 })
assert(formOk.report.status === 'no_failure_observed', `healthy form status ${formOk.report.status}`)

const silentNoProse: VisualAnalysis = {
  startingConditions: [{ timestampMs: 0, description: 'List view. Status choice Open. Page 1.' }],
  startingState: [
    { name: 'status choice', value: 'Open', kind: 'selection' },
    { name: 'current page', value: '1', kind: 'navigation' }
  ],
  stateObservations: [
    {
      timestampMs: 5000,
      context: 'List view',
      interaction: 'clicked next page',
      actedOn: 'page control',
      actedOnKind: 'navigation',
      stateBefore: [
        { name: 'status choice', value: 'Open', kind: 'selection' },
        { name: 'current page', value: '1', kind: 'navigation' }
      ],
      stateAfter: [
        { name: 'status choice', value: 'Any', kind: 'selection' },
        { name: 'current page', value: '2', kind: 'navigation' }
      ],
      visibleEvidence: 'Page 2 is highlighted and the status choice reads Any',
      confidence: 0.88
    }
  ],
  visibleActions: [{ timestampMs: 5000, description: 'Clicked next page', type: 'user_action' }],
  visibleFailures: [],
  speakerVisualContradictions: [],
  expectedBehaviorFromUi: { value: null, established: false },
  unknowns: []
}
const silentState = mergeEvidence({ transcript: [], visual: silentNoProse, videoDurationMs: 9000 })
assert(
  silentState.report.status === 'confirmed',
  `silent structured miss-case status ${silentState.report.status}`
)
assert(
  silentState.report.observedFailure?.source === 'visible' &&
    /status choice/i.test(silentState.report.observedFailure.text),
  'post-navigation selected state must not be dropped when prose has no defect words'
)

const clickOptionLabel: VisualAnalysis = {
  startingConditions: [{ timestampMs: 0, description: 'List view. Status choice All.' }],
  startingState: [
    { name: 'Status Filter', value: 'All', kind: 'selection' },
    { name: 'Selected filter', value: 'All', kind: 'selection' }
  ],
  stateObservations: [
    {
      timestampMs: 3000,
      context: 'List view',
      interaction: 'click',
      actedOn: 'Open',
      actedOnKind: 'selection',
      stateBefore: [
        { name: 'Status Filter', value: 'All', kind: 'selection' },
        { name: 'Selected filter', value: 'All', kind: 'selection' }
      ],
      stateAfter: [
        { name: 'Status Filter', value: 'Open', kind: 'selection' },
        { name: 'Selected filter', value: 'Open', kind: 'selection' }
      ],
      visibleEvidence: 'Open is highlighted',
      confidence: 1
    }
  ],
  visibleActions: [{ timestampMs: 3000, description: 'User clicks Open.', type: 'user_action' }],
  visibleFailures: [],
  speakerVisualContradictions: [],
  expectedBehaviorFromUi: { value: null, established: false },
  unknowns: []
}
const optionClick = mergeEvidence({ transcript: [], visual: clickOptionLabel, videoDurationMs: 6000 })
assert(
  optionClick.report.status === 'no_failure_observed',
  `clicking a labeled option must be a direct change, status ${optionClick.report.status}`
)
assert(
  optionClick.report.primaryFinding.outcome === 'no_visual_failure',
  'direct option click must not be the primary failure'
)

const misattributedClear: VisualAnalysis = {
  startingConditions: [{ timestampMs: 0, description: 'Form. Name Sam Rivera. Urgency Normal.' }],
  startingState: [
    { name: 'Requester name', value: 'Sam Rivera', kind: 'text_value' },
    { name: 'Urgency', value: 'Normal', kind: 'selection' },
    { name: 'Entered name', value: 'Sam Rivera', kind: 'text_value' }
  ],
  stateObservations: [
    {
      timestampMs: 4000,
      context: 'Form',
      interaction: 'Clear requester name input',
      actedOn: 'Requester name input field',
      actedOnKind: 'form',
      stateBefore: [
        { name: 'Requester name', value: 'Sam Rivera', kind: 'text_value' },
        { name: 'Urgency', value: 'Normal', kind: 'selection' },
        { name: 'Entered name', value: 'Sam Rivera', kind: 'text_value' }
      ],
      stateAfter: [
        { name: 'Requester name', value: 'Your name', kind: 'text_value' },
        { name: 'Urgency', value: 'Normal', kind: 'selection' },
        { name: 'Entered name', value: '(blank)', kind: 'text_value' }
      ],
      visibleEvidence: 'Entered name updates to (blank)',
      confidence: 1
    }
  ],
  visibleActions: [{ timestampMs: 4000, description: 'Requester name input is cleared.', type: 'user_action' }],
  visibleFailures: [],
  speakerVisualContradictions: [],
  expectedBehaviorFromUi: { value: null, established: false },
  unknowns: []
}
const misattributed = mergeEvidence({ transcript: [], visual: misattributedClear, videoDurationMs: 7000 })
assert(
  misattributed.report.status === 'confirmed',
  `misattributed clear status ${misattributed.report.status}`
)
assert(
  /Entered name/i.test(misattributed.report.observedFailure?.text ?? ''),
  'a mirrored empty value must still be a secondary disappearance'
)

const rewindBefore: VisualAnalysis = {
  startingConditions: [{ timestampMs: 0, description: 'List. Status Open. Page 1.' }],
  startingState: [
    { name: 'status choice', value: 'All', kind: 'selection' },
    { name: 'current page', value: '1', kind: 'navigation' }
  ],
  stateObservations: [
    {
      timestampMs: 2000,
      context: 'List',
      interaction: 'clicked Open',
      actedOn: 'Open',
      actedOnKind: 'selection',
      stateBefore: [
        { name: 'status choice', value: 'All', kind: 'selection' },
        { name: 'current page', value: '1', kind: 'navigation' }
      ],
      stateAfter: [
        { name: 'status choice', value: 'Open', kind: 'selection' },
        { name: 'current page', value: '1', kind: 'navigation' }
      ],
      visibleEvidence: 'Open is selected',
      confidence: 1
    },
    {
      timestampMs: 6000,
      context: 'List',
      interaction: 'clicked next page',
      actedOn: 'page control',
      actedOnKind: 'navigation',
      stateBefore: [
        { name: 'status choice', value: 'All', kind: 'selection' },
        { name: 'current page', value: '2', kind: 'navigation' }
      ],
      stateAfter: [
        { name: 'status choice', value: 'Any', kind: 'selection' },
        { name: 'current page', value: '2', kind: 'navigation' }
      ],
      visibleEvidence: 'Page 2 is shown',
      confidence: 1
    }
  ],
  visibleActions: [
    { timestampMs: 2000, description: 'Clicked Open', type: 'user_action' },
    { timestampMs: 6000, description: 'Clicked next page', type: 'user_action' }
  ],
  visibleFailures: [],
  speakerVisualContradictions: [],
  expectedBehaviorFromUi: { value: null, established: false },
  unknowns: []
}
const rewind = mergeEvidence({ transcript: [], visual: rewindBefore, videoDurationMs: 8000 })
assert(rewind.report.status === 'confirmed', `rewind-before status ${rewind.report.status}`)
assert(
  /status choice/i.test(rewind.report.observedFailure?.text ?? '') &&
    /Open/i.test(rewind.report.observedFailure?.text ?? ''),
  'established selected state must be carried forward when a later snapshot rewinds it'
)

const intendedClickThenReset: VisualAnalysis = {
  startingConditions: [{ timestampMs: 0, description: 'List. Choice Open. Page 1.' }],
  startingState: [
    { name: 'status choice', value: 'All', kind: 'selection' },
    { name: 'current page', value: '1', kind: 'navigation' }
  ],
  stateObservations: [
    {
      timestampMs: 2500,
      context: 'List',
      interaction: 'clicked Open',
      actedOn: 'Open',
      actedOnKind: 'selection',
      stateBefore: [
        { name: 'status choice', value: 'All', kind: 'selection' },
        { name: 'current page', value: '1', kind: 'navigation' }
      ],
      stateAfter: [
        { name: 'status choice', value: 'Open', kind: 'selection' },
        { name: 'current page', value: '1', kind: 'navigation' }
      ],
      visibleEvidence: 'Open is highlighted',
      confidence: 1
    },
    {
      timestampMs: 8000,
      context: 'List',
      interaction: 'clicked next page',
      actedOn: 'page control',
      actedOnKind: 'navigation',
      stateBefore: [
        { name: 'status choice', value: 'Open', kind: 'selection' },
        { name: 'current page', value: '1', kind: 'navigation' }
      ],
      stateAfter: [
        { name: 'status choice', value: 'Any', kind: 'selection' },
        { name: 'current page', value: '2', kind: 'navigation' }
      ],
      visibleEvidence: 'Page 2 is shown and the choice reads Any',
      confidence: 1
    }
  ],
  visibleActions: [
    { timestampMs: 2500, description: 'Clicked Open', type: 'user_action' },
    { timestampMs: 8000, description: 'Clicked next page', type: 'user_action' }
  ],
  visibleFailures: [
    {
      timestampMs: 2500,
      description: 'The visible value of "status choice" changed from "All" to "Open" without a visible interaction targeting that control.'
    }
  ],
  speakerVisualContradictions: [],
  expectedBehaviorFromUi: { value: null, established: false },
  unknowns: ['Underlying code', 'Application source code was not provided.', 'Browser version was not visible.']
}
const ranked = mergeEvidence({ transcript: [], visual: intendedClickThenReset, videoDurationMs: 10000 })
assert(ranked.report.status === 'confirmed', `ranked status ${ranked.report.status}`)
assert(ranked.report.primaryFinding.outcome === 'bug_detected', 'ranked primary')
assert(
  /Any/i.test(ranked.report.primaryFinding.postState ?? '') &&
    /next page/i.test(ranked.report.primaryFinding.action ?? ''),
  'primary failure must be the later unrelated change, not the intended option click'
)
assert(
  ranked.report.unknowns.filter((item) => /source code/i.test(item)).length === 1,
  'code unknowns must be semantically deduplicated'
)
assert(
  ranked.report.unknowns.filter((item) => /browser/i.test(item)).length === 1,
  'browser unknowns must be semantically deduplicated'
)

console.log(
  'evidence merger ground-truth checks passed (A/B/C + generic checkout/form/silent state tracking)'
)
