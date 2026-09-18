# Upstream attribution

This repository started as an open-source **Interview Copilot** desktop app
(package name `iview-protect`, product name “Iview Protect”).

The original README described it as an educational/open clone of
[parakeet-ai.com](https://parakeet-ai.com), licensed **MIT** in `package.json`.
The workspace copy did not include a `LICENSE` file or `.git` remote; MIT
attribution is preserved here and in `LICENSE`.

## Original architecture (unchanged facts)

Electron main process + React renderer (electron-vite):

- `src/main/stt.ts` — OpenAI-compatible Whisper transcription (Groq by default)
- `src/main/llm.ts` — streaming OpenAI-compatible + Gemini SSE clients
- `src/renderer` — overlay UI, `useAudioCapture`, settings, answer view
- Stealth overlay, global hotkeys, click-through, resume/JD prompts

## Reused (adapted)

| Original | Now | What was kept |
| --- | --- | --- |
| `src/main/stt.ts` | `src/transcription/groq.ts` | OpenAI-compatible `audio/transcriptions` FormData + Bearer auth |
| `src/main/llm.ts` Gemini fetch | `src/ai/gemini.ts` | Gemini REST URL, `systemInstruction`, `generationConfig`, error text slice |
| `src/renderer/src/assets/main.css` tokens | same file (rewritten layout) | Color tokens, buttons, banners |
| `src/renderer/src/lib/id.ts` | `src/shared/id.ts` | Random id helper |
| `src/renderer/src/hooks/useAudioCapture.ts` | kept | Mic / display-media capture patterns for live beta |
| TypeScript, React 19, Vite, Prettier, ESLint | kept | Tooling |
| Default Groq Whisper model name | `src/config/pricing.ts` + env | `whisper-large-v3-turbo` |

## Removed (interview-copilot-specific)

- Electron BrowserWindow stealth (`setContentProtection`, always-on-top, click-through)
- Global hotkeys and IPC
- Resume / job-description interview prompts and auto-answer UI
- `electron-builder` packaging
- Overlay-only renderer chrome

The Evidence Replay product (MP4 pipeline, evidence model, demo defect, report UI)
is new work in this derivative.
