import { JSX, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Unrelated fixture UI for generalization tests: a desk-request form, not a catalog.
 * Defect (default): choosing Urgent clears the requester name that was already entered.
 */
export function NoteComposer(): JSX.Element {
  const [params] = useSearchParams()
  const defectOn = params.get('defect') !== 'off'
  const [name, setName] = useState('')
  const [details, setDetails] = useState('')
  const [urgency, setUrgency] = useState<'Normal' | 'Urgent'>('Normal')
  const [saved, setSaved] = useState('')

  const setUrgent = (): void => {
    setUrgency('Urgent')
    if (defectOn) setName('')
  }

  return (
    <div className="note-app" data-testid="note-app">
      <header className="note-header">
        <p className="demo-kicker">Facilities intake</p>
        <h1>Desk request</h1>
      </header>

      <form
        className="note-form"
        onSubmit={(e) => {
          e.preventDefault()
          setSaved(name.trim() ? `${name} · ${urgency}` : '(empty name)')
        }}
      >
        <label>
          Requester name
          <input
            data-testid="requester-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder=""
          />
        </label>
        <label>
          What do you need?
          <textarea
            data-testid="request-details"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={3}
            placeholder="Monitor arm, extra outlet…"
          />
        </label>
        <div>
          <span className="demo-label">Urgency</span>
          <div className="note-urgency">
            <button
              type="button"
              data-testid="urgency-normal"
              className={urgency === 'Normal' ? 'is-selected' : ''}
              onClick={() => setUrgency('Normal')}
            >
              Normal
            </button>
            <button
              type="button"
              data-testid="urgency-urgent"
              className={urgency === 'Urgent' ? 'is-selected' : ''}
              onClick={setUrgent}
            >
              Urgent
            </button>
          </div>
        </div>
        <p className="note-live" data-testid="entered-name">
          Live preview: <strong>{name || '(blank)'}</strong>
        </p>
        <button type="submit" data-testid="save-draft">
          Save draft
        </button>
      </form>
      {saved ? (
        <p className="note-saved" data-testid="saved-draft">
          Draft: {saved}
        </p>
      ) : null}
    </div>
  )
}
