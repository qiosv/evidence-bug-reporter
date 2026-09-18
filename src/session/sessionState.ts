import type { EvidenceEvent, SessionState } from '../shared/types'

export function createSessionState(): SessionState {
  return {
    events: [],
    previousIssues: [],
    changes: [],
    transcript: []
  }
}

export function appendEvent(state: SessionState, event: EvidenceEvent): SessionState {
  return { ...state, events: [...state.events, event] }
}
