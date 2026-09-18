# Evidence Replay

Browser prototype that turns a short **MP4 screen recording** into an
**evidence-grounded, reproducible bug report**.

This is not “upload video, ask AI to summarize.” The product reconstructs visible
user actions even when they were not narrated, and it **never treats speaker
statements as visual facts**.

Derived from the open-source Interview Copilot / Iview Protect Electron app.
See [UPSTREAM.md](./UPSTREAM.md) and [LICENSE](./LICENSE).

## Project overview

Two input modes:

1. **Analyze recording (required, frozen)** — MP4, max 90 seconds, optional speech.
2. **Live analysis beta (optional)** — user-picked screen share + microphone,
   local 1.5s frame sampling, chunked xAI STT, session timeline. Not a hidden
   capture, and not a full realtime agent.

Every important statement is labeled:

- **VISIBLE** — seen on screen
- **CLAIMED** — said by the speaker
- **UNKNOWN** — not established by evidence

## Architecture (final)

```
MP4 → validation → audio extraction → xAI Speech-to-Text → timestamped transcript
MP4 → Gemini 3.5 Flash-Lite visual analysis
→ Evidence Merger → Zod BugReport
```

Groq Whisper remains an optional `TRANSCRIPTION_PROVIDER=groq` implementation.
It was **not** used in final validation.

Live beta (separate from the frozen MP4 pipeline):

```
getDisplayMedia + getUserMedia
→ local pixel-diff sampling (~1.5s; skip near-identical frames)
→ microphone chunks → same xAI STT path
→ EvidenceEvent timeline + session memory
```

Gemini is **not** called on every live frame.

Speech and video are separate evidence channels. The merger decides report
`status`:

| Status | Meaning |
| --- | --- |
| `confirmed` | Failure is visible on screen |
| `claimed_not_observed` | Speaker claimed a failure; screen did not confirm it |
| `insufficient_evidence` | Not enough to reconstruct |
| `no_failure_observed` | Visible path reconstructed; no failure seen |

## What was reused from upstream

- Groq/OpenAI-compatible STT request pattern (`src/main/stt.ts` → `src/transcription/groq.ts`, optional fallback)
- Gemini REST client shape (`src/main/llm.ts` → `src/ai/gemini.ts`)
- React 19 + TypeScript + Vite + Prettier + ESLint
- CSS color tokens
- `useAudioCapture` hook (kept for live capture patterns)

Details: [UPSTREAM.md](./UPSTREAM.md).

## What we changed

- Replaced Electron overlay / stealth / hotkeys / IPC with a **browser app + Express API**
- Added the evidence model, merger, structured bug report, demo defect, fixtures, metrics, cost
- Active STT is xAI REST Speech-to-Text; Gemini remains visual analysis only
- **BYOK** (default): reviewers supply xAI + Gemini keys in the browser for the current session
- **SERVER** mode: local/developer-controlled `.env` keys, never mixed with BYOK
- Live beta: explicit permission, local sampling, chunked STT, session memory

## Setup

Requirements: Node 20+, ffmpeg/ffprobe on PATH. Public deploys use **BYOK** (reviewers enter their own xAI and Gemini keys). Local pipeline validation can use `API_KEY_MODE=server` with keys in `.env`.

```bash
npm install
copy .env.example .env   # Windows
# then set XAI_API_KEY, TRANSCRIPTION_PROVIDER=xai, and GEMINI_API_KEY
```

## Environment variables

| Name | Purpose |
| --- | --- |
| `API_KEY_MODE` | `byok` (public default) or `server` (local/developer keys) |
| `XAI_API_KEY` | xAI Speech-to-Text. Used only when `API_KEY_MODE=server`. Placeholder in `.env.example`. |
| `TRANSCRIPTION_PROVIDER` | `xai` (active) or `groq` (optional, unvalidated fallback) |
| `GEMINI_API_KEY` | Gemini video analysis. Used only when `API_KEY_MODE=server`. |
| `GEMINI_MODEL` | default `gemini-3.5-flash-lite` |
| `GROQ_API_KEY` | optional Groq Whisper fallback (`server` mode only) |
| `GROQ_STT_MODEL` | default `whisper-large-v3-turbo` when Groq is selected |
| `GEMINI_BASE_URL` | optional Gemini REST base |
| `GROQ_BASE_URL` | optional Groq OpenAI-compatible base |
| `XAI_BASE_URL` | optional xAI REST base, default `https://api.x.ai/v1` |
| `PORT` | API port, default `8787` |

### BYOK vs SERVER

- **`byok` (public default)** — the browser sends the reviewer’s xAI and Gemini keys on each processing/connection request (`X-User-XAI-Key`, `X-User-Gemini-Key`). The backend uses those credentials for that request only and discards them. Server `.env` provider keys are **not** used and there is **no silent fallback**. Keys stay in browser memory for the tab session and are cleared on refresh/close. They are not written to localStorage, cookies, disk, logs, or the BugReport.
- **`server`** — existing local development: Express reads `XAI_API_KEY` / `GEMINI_API_KEY` from `.env`. User headers are ignored so the two sources are never mixed.

Never commit `.env`. Never prefix keys with `VITE_`. Never put developer keys in the frontend bundle.

## How to run locally

```bash
npm run dev
```

- UI: http://localhost:5173
- API: http://localhost:8787 (proxied as `/api`)

Open **Demo defect** (`/demo`) to reproduce the intentional catalog bug:

1. Status All → Active
2. Click Page 2
3. Status becomes All

`/demo?defect=off` is the working catalog used by test recording C.

## How to build / production start

```bash
npm run build
npm start
```

`npm start` serves the API and the production client from `dist/client` on `PORT`.
ffmpeg must be installed on the host.

Public prototype (reviewers supply keys in the UI):

```bash
docker build -t evidence-replay .
docker run --rm -p 8787:8787 -e API_KEY_MODE=byok evidence-replay
```

Do **not** pass `XAI_API_KEY` or `GEMINI_API_KEY` into a public container. The image does not bake in `.env`.

Local/developer SERVER mode (optional):

```bash
docker run --rm -p 8787:8787 -e API_KEY_MODE=server -e TRANSCRIPTION_PROVIDER=xai -e XAI_API_KEY -e GEMINI_API_KEY evidence-replay
```

On PowerShell/cmd, `-e XAI_API_KEY` and `-e GEMINI_API_KEY` pass through your existing environment (do not paste key values into the command).

## How to run sample tests

```bash
npm run test:merger          # deterministic evidence-merger checks (no API keys)
npm run test:credentials    # BYOK/SERVER isolation, no live keys printed
npm run scan:persistence    # keys are not written to web storage
npm run fixtures             # while npm run dev is up; writes tests/fixtures/*.mp4
npm run validate:errors      # non-MP4 / >90s / corrupt upload handling
npm run validate:pipeline    # real xAI STT + Gemini on tests A/B/C (SERVER / .env keys)
npm run validate:byok        # HTTP BYOK analysis; server env keys forced unused
```

Ground truth:

- `tests/fixtures/test-a.expected.json`
- `tests/fixtures/test-b.expected.json`
- `tests/fixtures/test-c.expected.json`

Human reproducibility pack (tester must **not** watch the source MP4 first):
`tests/human-repro/test-a-report.json` plus http://localhost:5173/demo

## Mandatory validation (measured)

Active models: **xAI Speech-to-Text REST** + **Gemini `gemini-3.5-flash-lite`**.

| Recording | Expected | Actual | Pass |
| --- | --- | --- | --- |
| test-a | `confirmed`; Active → Page 2 → filter reset | `confirmed` | PASS |
| test-b | `confirmed`; silent visible actions | `confirmed`; steps `source=visible` | PASS |
| test-c | `claimed_not_observed` | `claimed_not_observed`; spoken reset is speaker-only | PASS |
| new-input | processed | `no_failure_observed`; 2 visible steps | processed |

Latest freeze pipeline timings (`total_ms` = time to useful result):

| | validation | transcription | video | total | retries | variable USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 71 | 807 | 3732 | 4614 | 1 | 0.003639 |
| B | 90 | 924 | 121936 | 122951 | 1 | 0.002863 |
| C | 1665 | 2505 | 3864 | 8035 | 1 | 0.002899 |
| new-input | 192 | 1166 | 3368 | 4727 | 1 | 0.002611 |

xAI STT list price: **$0.10 / hour** × measured audio duration. Gemini 3.5 Flash-Lite:
**$0.30 / 1M input**, **$2.50 / 1M output**. Free credits are not treated as $0.

## Live beta

Open http://localhost:5173/live in **Chrome or Edge** (localhost is a secure context).
Click **Start live analysis**, pick a tab/window, allow the microphone, then **Stop**.

Permission errors are split: insecure context, screen cancelled, screen denied,
screen unsupported, microphone denied/cancelled. Each has **Retry**.

The Cursor embedded browser exposes `getDisplayMedia` but returns `NotSupportedError`.
That is not a localhost problem.

## Known limitations

- MP4 only, ≤ 90 seconds, one speaker assumed
- No audio is allowed (optional narration)
- Gemini may miss a control or hallucinate a visual change; timestamps exist so a reviewer can check
- Gemini Flash-Lite often needs one JSON schema retry; video analysis can stall (Test B freeze run: 122s)
- Live beta does not send every frame to Gemini and is not a full live report
- SEO/DOM/code inspection is not implemented
- No account system, no persistence beyond the current page

## Time spent

Targeted as an ~8 hour take-home: audit, web migration, demo, MP4 pipeline, report UX,
fixtures, xAI STT cutover, metrics, docs, and a timeboxed Live beta.

## Scripts

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
npm run fixtures
npm run test:merger
npm run test:credentials
npm run scan:persistence
npm run validate:errors
npm run validate:pipeline
npm run validate:byok
```
