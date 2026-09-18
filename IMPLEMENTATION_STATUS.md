# Implementation status

Last updated: 2026-09-16

## Completed

- Frozen mandatory pipeline: xAI STT → Gemini visual → Evidence Merger → BugReport
- Groq retained as optional unvalidated fallback
- A/B/C + new-input regression PASS on the latest pipeline run
- Timeboxed Live beta (permissions, local sampling, chunked STT, session memory)
- README, DELIVERY, human-repro pack, Dockerfile
- Merger tests, lint/typecheck as of submission prep

## Gate status

| Item | Status |
| --- | --- |
| API security | PASS |
| xAI STT | PASS |
| Groq | SKIPPED (optional) |
| Gemini | PASS (`gemini-3.5-flash-lite`, often 1 JSON retry) |
| Test A | PASS |
| Test B | PASS |
| Test C | PASS |
| New input | processed |
| Live Beta | PARTIAL (STT chunks work; screen share NotSupported in Cursor browser) |
| Git | initialized (`master`); first commit pending local `user.name` / `user.email` (not written by the agent) |
| Deployment | prepared, not verified live |
| Human reproduction | pack ready; result pending |

## Deferred

- Full Gemini Live socket / realtime STT websocket
- DOM/SEO/code inspector
- Hosted production deploy
- Second-person human reproduction timing

## Known issues

- Cursor/embedded Chromium: `getDisplayMedia` → `NotSupportedError`. Use Chrome/Edge on localhost.
- Gemini Flash-Lite often needs one JSON retry; visual wording still varies between runs.
- xAI may mis-hear fixture TTS (Cyrillic fragments); those lines stay speaker claims.
- Live beta does not produce a full BugReport.
