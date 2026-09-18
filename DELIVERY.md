# Delivery notes

## Scope delivered

- Browser app (Vite React + Express) migrated from the Electron Interview Copilot repo
- Buggy product-listing demo (filter resets on pagination)
- Frozen mandatory flow: **xAI Speech-to-Text → Gemini visual analysis → Evidence Merger → BugReport**
- Groq Whisper kept as optional `TRANSCRIPTION_PROVIDER=groq` (not used in validation)
- Deterministic evidence merger with VISIBLE / CLAIMED / UNKNOWN
- Structured Zod-validated bug report, clickable timestamps, canvas frames
- Timeboxed Live analysis beta (explicit screen + mic permission, local sampling, chunked xAI STT)
- BYOK: reviewers supply xAI + Gemini keys in the UI; request-scoped, in-memory, not persisted
- Metrics + variable cost from `src/config/pricing.ts`
- Dockerfile for Node 20 + ffmpeg (`API_KEY_MODE=byok` by default; not deployed from this machine)

Not delivered: accounts, Jira/Slack, DOM/SEO crawler, full Gemini Live socket, billing.

## Final architecture

```
MP4 → validation → audio extraction → xAI STT → timestamped transcript
MP4 → Gemini 3.5 Flash-Lite visual analysis
→ Evidence Merger → Zod BugReport
```

## Security

- `.env` gitignored. `.env.example` has names/placeholders only, including `API_KEY_MODE=byok`.
- Public prototype default is **BYOK**: reviewers paste their own provider credentials in the browser.
- BYOK keys are kept in tab memory only, sent to the backend as request headers, used for that request, and discarded. They are not stored in localStorage, cookies, disk, logs, BugReports, or exported JSON.
- `API_KEY_MODE=byok` never falls back to developer/server `.env` keys. Missing or invalid keys return a clear error.
- `API_KEY_MODE=server` is for local/developer-controlled use and ignores user key headers so the sources are never mixed.
- Vite `envDir` is `src/renderer`, `envPrefix` is `VITE_`.
- Provider errors to the browser are sanitized. Auth failures say to check the API key without echoing it.

## Test recordings (regression)

| File | Expected | Actual | Pass/fail |
| --- | --- | --- | --- |
| `tests/fixtures/test-a.mp4` | `confirmed`; Active → Page 2 → filter reset | `confirmed`; `observedFailure.source = visible` | PASS |
| `tests/fixtures/test-b.mp4` | `confirmed`; silent visible actions | `confirmed`; silent steps `source = visible` | PASS |
| `tests/fixtures/test-c.mp4` | `claimed_not_observed` | `claimed_not_observed`; spoken reset is speaker-only | PASS |
| `tests/fixtures/new-input.mp4` | processed | `no_failure_observed`; 2 visible steps | processed |

## Provider connectivity

| Provider | Model | Result |
| --- | --- | --- |
| xAI STT | REST `POST /v1/stt` | HTTP 200 (mandatory + live chunk endpoint) |
| Groq | whisper-large-v3-turbo | optional; **not used** |
| Gemini | `gemini-3.5-flash-lite` | HTTP 200 inline video; often 1 JSON retry |

Live chunk STT (`POST /api/live/transcribe` on fixture wav): HTTP 200, 2212 ms, 24 words.

## Measurements (freeze `npm run validate:pipeline`)

| Recording | validation_ms | transcription_ms | video_analysis_ms | retries | total_ms | Gemini in/out | retry in/out | USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| test-a | 71 | 807 | 3732 | 1 | 4614 | 3015 / 911 | 819 / 462 | 0.003639 |
| test-b | 90 | 924 | 121936 | 1 | 122951 | 2245 / 769 | 748 / 391 | 0.002863 |
| test-c | 1665 | 2505 | 3864 | 1 | 8035 | 2177 / 801 | 764 / 407 | 0.002899 |
| new-input | 192 | 1166 | 3368 | 1 | 4727 | 2029 / 717 | 722 / 365 | 0.002611 |

Test B’s 122s video step is a Gemini retry stall, not an STT failure. Status still `confirmed`.

STT: xAI REST **$0.10/hour**. Gemini 3.5 Flash-Lite **$0.30 / $2.50 per 1M**. Hosting separate. Credits ≠ $0.

## Live beta

- Explicit **Start live analysis** → `getDisplayMedia` then `getUserMedia`.
- Local 1.5s sampling; near-identical frames skipped; no per-frame Gemini.
- Microphone chunks go through the working xAI STT path.
- Session memory: timestamp, source, visible change, speaker statement, issue candidate, verification state.
- Never says a change “fixed the bug.” New problems are “appeared after Change X,” not “caused by Change X.”

Permission diagnosis (Cursor embedded browser on `http://localhost:5173/live`):

- Secure context: **yes** (`http://localhost`)
- `getDisplayMedia` exists: **yes**
- Actual error: **`NotSupportedError` / “Not supported”**
- Not a collapsed “Permission denied”
- Open the same URL in Chrome/Edge to share a tab

## Human reproducibility test

Pack: `tests/human-repro/test-a-report.json` + http://localhost:5173/demo

Tester must **not** watch `test-a.mp4` first.

| Field | Result |
| --- | --- |
| Tester | pending |
| Saw original recording | No (instruction) |
| Reproduced | **not recorded** — no second person has run this yet |
| Time | pending |
| Notes | Do not fabricate |

## Walkthrough script (≤ 3 minutes)

- **0:00–0:20 problem/product** — Short MP4 in; evidence-grounded bug report out. Visible UI is not the same as speaker claims.
- **0:20–0:50 upload new recording** — Analyze page, choose `new-input.mp4` (or any ≤90s MP4). Show validating → transcribing → visual analysis → report.
- **0:50–1:25 evidence-backed report** — Status pill, VISIBLE vs CLAIMED vs UNKNOWN, steps, observed failure or claimed-not-observed.
- **1:25–1:50 clickable timestamp/frame** — Click a timestamp; video seeks; canvas frame is the evidence still.
- **1:50–2:10 Test B silent action** — Open Tests, run B. Unnarrated Active + Page 2 still recovered as VISIBLE.
- **2:10–2:30 Test C unsupported claim** — Speaker says reset; screen stays Active; status `claimed_not_observed`.
- **2:30–2:45 latency + cost** — Typical clips ~4–8s; this freeze run A=4.6s, C=8.0s; B waited ~123s on a Gemini retry. xAI $0.10/hr + Gemini tokens; credits not shown as free.
- **2:45–3:00 Live Beta / architecture / limitation** — xAI STT + Gemini visual + merger. Live samples locally; Chrome/Edge for screen share. No SEO/root-cause from pixels.

## Deployment readiness

- `npm run build` && `npm start` serves UI + API.
- `Dockerfile` installs ffmpeg.
- Secrets: `XAI_API_KEY` / `GEMINI_API_KEY` server-side only.
- **Not deployed. Not verified in a hosted environment.**
