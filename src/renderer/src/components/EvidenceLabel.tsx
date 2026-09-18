import type { JSX } from 'react'
import { formatTimestamp } from '../../../shared/id'
import type { EvidenceSource } from '../../../shared/types'

interface Props {
  source: EvidenceSource
  timestampMs?: number
  onSeek?: (timestampMs: number) => void
}

export function EvidenceLabel({ source, timestampMs, onSeek }: Props): JSX.Element {
  const label = source === 'visible' ? 'VISIBLE' : source === 'speaker_claim' ? 'CLAIMED' : 'UNKNOWN'
  return (
    <span className={`ev-label ${source}`}>
      {label}
      {typeof timestampMs === 'number' && (
        <button
          type="button"
          className="ts-btn"
          onClick={() => onSeek?.(timestampMs)}
          title="Jump to this moment"
        >
          {formatTimestamp(timestampMs)}
        </button>
      )}
    </span>
  )
}
