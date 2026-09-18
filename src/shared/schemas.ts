import { z } from 'zod'

export const evidenceSourceSchema = z.enum(['visible', 'speaker_claim', 'unknown'])

export const evidenceEventTypeSchema = z.enum([
  'screen_state',
  'user_action',
  'speaker_statement',
  'failure',
  'change',
  'verification',
  'unknown'
])

export const visualActionSchema = z.object({
  timestampMs: z.number(),
  description: z.string().min(1),
  type: z.enum(['screen_state', 'user_action', 'failure', 'change', 'verification', 'unknown'])
})

export const statePropertySchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  kind: z.string().optional()
})

export const stateChangeSchema = z.object({
  name: z.string().min(1),
  before: z.string(),
  after: z.string(),
  kind: z.string().optional(),
  relation: z.enum(['direct_effect', 'secondary_effect', 'unrelated_change', 'unknown_relation'])
})

export const stateObservationSchema = z.object({
  timestampMs: z.number(),
  context: z.string().optional(),
  interaction: z.string().min(1),
  actedOn: z.string().optional(),
  actedOnKind: z.string().optional(),
  stateBefore: z.array(statePropertySchema).default([]),
  stateAfter: z.array(statePropertySchema).default([]),
  changedState: z.array(stateChangeSchema).optional(),
  visibleEvidence: z.string().optional(),
  confidence: z.number().optional()
})

export const visualAnalysisSchema = z.object({
  startingConditions: z
    .array(
      z.object({
        timestampMs: z.number(),
        description: z.string().min(1)
      })
    )
    .default([]),
  startingState: z.array(statePropertySchema).default([]),
  stateObservations: z.array(stateObservationSchema).default([]),
  visibleActions: z.array(visualActionSchema).default([]),
  visibleFailures: z
    .array(
      z.object({
        timestampMs: z.number(),
        description: z.string().min(1)
      })
    )
    .default([]),
  speakerVisualContradictions: z
    .array(
      z.object({
        timestampMs: z.number(),
        speakerClaim: z.string().min(1),
        visibleEvidence: z.string().min(1)
      })
    )
    .default([]),
  expectedBehaviorFromUi: z
    .object({
      value: z.string().nullable(),
      established: z.boolean(),
      source: z.string().optional()
    })
    .default({ value: null, established: false }),
  unknowns: z.array(z.string()).default([])
})

export const evidenceStatementSchema = z.object({
  text: z.string(),
  source: evidenceSourceSchema,
  timestampMs: z.number().optional(),
  established: z.boolean()
})

export const reproductionStepSchema = z.object({
  index: z.number().int().positive(),
  description: z.string(),
  timestampMs: z.number().optional(),
  source: evidenceSourceSchema,
  frameTimestampMs: z.number().optional()
})

export const primaryFindingSchema = z.object({
  outcome: z.enum([
    'bug_detected',
    'no_visual_failure',
    'claimed_not_observed',
    'insufficient_evidence'
  ]),
  title: z.string().min(1),
  explanation: z.string(),
  preState: z.string().optional(),
  action: z.string().optional(),
  postState: z.string().optional(),
  timestampMs: z.number().optional(),
  evidenceIds: z.array(z.string()),
  source: z.enum(['visible', 'speaker_claim', 'unknown', 'mixed']),
  rootCause: z.string().nullable(),
  confidence: z.number().optional()
})

export const bugReportSchema = z.object({
  title: z.string().min(1),
  status: z.enum([
    'confirmed',
    'claimed_not_observed',
    'insufficient_evidence',
    'no_failure_observed'
  ]),
  primaryFinding: primaryFindingSchema,
  startingConditions: z.array(evidenceStatementSchema),
  steps: z.array(reproductionStepSchema),
  observedFailure: evidenceStatementSchema.nullable().optional(),
  speakerClaims: z.array(evidenceStatementSchema),
  expectedBehavior: z.object({
    value: z.string().nullable(),
    established: z.boolean(),
    source: z.string().optional()
  }),
  unknowns: z.array(z.string()),
  summary: z.string(),
  evidence: z.array(
    z.object({
      id: z.string(),
      timestampMs: z.number(),
      source: evidenceSourceSchema,
      label: z.string()
    })
  )
})

export type VisualAnalysisParsed = z.infer<typeof visualAnalysisSchema>
export type BugReportParsed = z.infer<typeof bugReportSchema>

/** Gemini responseSchema (OpenAPI-like subset). */
const geminiStatePropertySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    value: { type: 'string' },
    kind: {
      type: 'string',
      enum: [
        'selection',
        'text_value',
        'navigation',
        'result_set',
        'modal',
        'sort',
        'cart',
        'form',
        'authentication',
        'validation',
        'visibility',
        'enabled',
        'other'
      ]
    }
  },
  required: ['name', 'value', 'kind']
} as const

export const geminiVisualResponseSchema = {
  type: 'object',
  properties: {
    startingConditions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timestampMs: { type: 'integer' },
          description: { type: 'string' }
        },
        required: ['timestampMs', 'description']
      }
    },
    startingState: {
      type: 'array',
      items: geminiStatePropertySchema
    },
    stateObservations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timestampMs: { type: 'integer' },
          context: { type: 'string' },
          interaction: { type: 'string' },
          actedOn: { type: 'string' },
          actedOnKind: { type: 'string' },
          stateBefore: { type: 'array', items: geminiStatePropertySchema },
          stateAfter: { type: 'array', items: geminiStatePropertySchema },
          visibleEvidence: { type: 'string' },
          confidence: { type: 'number' }
        },
        required: [
          'timestampMs',
          'context',
          'interaction',
          'actedOn',
          'actedOnKind',
          'stateBefore',
          'stateAfter',
          'visibleEvidence',
          'confidence'
        ]
      }
    },
    visibleActions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timestampMs: { type: 'integer' },
          description: { type: 'string' },
          type: {
            type: 'string',
            enum: ['screen_state', 'user_action', 'failure', 'change', 'verification', 'unknown']
          }
        },
        required: ['timestampMs', 'description', 'type']
      }
    },
    visibleFailures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timestampMs: { type: 'integer' },
          description: { type: 'string' }
        },
        required: ['timestampMs', 'description']
      }
    },
    speakerVisualContradictions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timestampMs: { type: 'integer' },
          speakerClaim: { type: 'string' },
          visibleEvidence: { type: 'string' }
        },
        required: ['timestampMs', 'speakerClaim', 'visibleEvidence']
      }
    },
    expectedBehaviorFromUi: {
      type: 'object',
      properties: {
        value: { type: 'string', nullable: true },
        established: { type: 'boolean' },
        source: { type: 'string' }
      },
      required: ['established']
    },
    unknowns: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: [
    'startingConditions',
    'startingState',
    'stateObservations',
    'visibleActions',
    'visibleFailures',
    'speakerVisualContradictions',
    'expectedBehaviorFromUi',
    'unknowns'
  ]
} as const
