export type CaptureKind =
  | 'insecure_context'
  | 'unsupported'
  | 'screen_cancelled'
  | 'screen_denied'
  | 'screen_failed'
  | 'microphone_denied'
  | 'microphone_cancelled'
  | 'microphone_failed'

export interface CaptureFeedback {
  kind: CaptureKind
  message: string
}

export function requireCaptureSupport(): CaptureFeedback | null {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return {
      kind: 'insecure_context',
      message:
        'Screen and microphone capture need a secure context (https or localhost). This page is not treated as secure.'
    }
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia || !navigator.mediaDevices.getUserMedia) {
    return {
      kind: 'unsupported',
      message:
        'This browser does not expose screen/microphone capture APIs. Use an up-to-date Chrome, Edge, or Firefox on localhost.'
    }
  }
  return null
}

export function describeCaptureError(stage: 'screen' | 'microphone', err: unknown): CaptureFeedback {
  const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : ''
  const raw = err instanceof Error ? err.message : String(err)
  const cancelled = name === 'AbortError' || /cancel|dismiss|abort/i.test(raw)
  const denied = name === 'NotAllowedError' || /permission|denied|notallowed/i.test(raw)

  if (stage === 'screen') {
    if (name === 'NotSupportedError' || /not supported/i.test(raw)) {
      return {
        kind: 'screen_failed',
        message:
          'This browser window cannot share a screen (getDisplayMedia is present but returns NotSupported). localhost is a secure context. Open http://localhost:5173/live in Chrome or Edge, then Retry.'
      }
    }
    if (cancelled) {
      return {
        kind: 'screen_cancelled',
        message: 'Screen selection was cancelled. Click Retry and choose a tab, window, or screen.'
      }
    }
    if (denied) {
      return {
        kind: 'screen_denied',
        message:
          'Screen/window/tab permission was not granted. Allow display capture when the browser prompt appears, then Retry.'
      }
    }
    return {
      kind: 'screen_failed',
      message: 'Screen capture failed. The browser could not start getDisplayMedia. Click Retry to try again.'
    }
  }

  if (cancelled) {
    return {
      kind: 'microphone_cancelled',
      message: 'Microphone prompt was cancelled. Click Retry and allow the microphone.'
    }
  }
  if (denied) {
    return {
      kind: 'microphone_denied',
      message:
        'Microphone permission was denied. Unblock the microphone for this site in the browser, then Retry.'
    }
  }
  return {
    kind: 'microphone_failed',
    message: 'Microphone capture failed. Check that a microphone is connected, then Retry.'
  }
}
