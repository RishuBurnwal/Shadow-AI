# Shadow AI Release Audit

Date: 2026-07-16

## Release decision

Engineering status: **PASS**. No tested module is broken. The application launches, packages, renders under Electron 40, and passes all automated and real STT checks.

Non-engineering release gate: **C-00 remains unresolved**. Distribution must continue to comply with GPL-3.0 and preserve attribution unless a separate relicensing agreement is obtained.

## Original audit reconciliation

| ID   | Status              | Evidence                                                                                                                                                                   |
| ---- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-00 | External decision   | GPL-3.0 and original attribution remain intact; no attempt was made to relicense the project.                                                                              |
| F-01 | Fixed               | Gemini Live requests input transcription and never requests AUDIO response modality. Regression contract added.                                                            |
| F-02 | Fixed               | One `TURN_STATE` reducer handles input, turn completion, generation fallback, answer streaming, and barge-in.                                                              |
| F-03 | Fixed               | Rolling Whisper input is capped at five seconds instead of growing with the full utterance.                                                                                |
| F-04 | Fixed               | Final transcription no longer waits on the rolling mutex. Two simultaneous real Whisper inferences completed successfully.                                                 |
| F-05 | Fixed               | Persisted 300–1200 ms VAD silence control is exposed in Settings and applied live by the backend.                                                                          |
| F-06 | Fixed               | Local browser capture requests native 16 kHz audio. The 24→16 kHz resampler remains only as a compatibility fallback.                                                      |
| F-07 | Fixed as specified  | Both cloud and local paths emit structured speech-end→transcription-ready and transcription-ready→first-token timings. The intentional cloud two-hop architecture remains. |
| F-08 | Verified            | Each renderer audio chunk is immediately forwarded with `sendRealtimeInput`; no client batching exists.                                                                    |
| S-01 | Fixed               | `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, and an allow-listed preload bridge are active.                                                           |
| S-02 | Fixed               | AI Markdown is sanitized before `innerHTML`; dangerous elements, event handlers, styles, and unsafe URL schemes are removed.                                               |
| S-03 | Fixed               | Supported Whisper models use immutable revisions and verified SHA-256 hashes for quantized encoder/decoder ONNX weights before use. Corrupt cache entries are deleted.     |
| S-04 | Fixed               | The broken lazy `safeStorage` initialization was corrected. Electron refuses plaintext credential fallback.                                                                |
| S-05 | Fixed for runtime   | Electron upgraded from 30 to 40.10.2 and `@google/genai` to 2.12.0. Production dependency audit reports zero vulnerabilities.                                              |
| A-01 | Fixed               | Reconnect creates one fresh turn state, preserves history, and returns immediately after success.                                                                          |
| A-02 | Fixed               | RMS is documented as a gate for Silero; VAD timeout has one persisted setting.                                                                                             |
| A-03 | Fixed pragmatically | Launcher readiness timeout increased from 12 to 60 seconds and a live launcher smoke passed.                                                                               |
| A-04 | Improved            | 72 unit/contract tests and 20 Electron e2e tests pass. Coverage executes successfully at 36.6%; broader behavioral coverage remains future work.                           |

## Verification evidence

- Unit and contract tests: **72/72 passed**.
- Electron end-to-end tests: **20/20 passed**.
- Windows packaging: **passed** with Electron Forge.
- Windows launcher: **passed** and reported `Shadow AI started (silent mode)`.
- Production dependency audit: **0 vulnerabilities**.
- Real STT: pinned Whisper Tiny on CPU transcribed `The quick brown fox jumps over the lazy dog.` exactly.
- Concurrent STT: two overlapping native inferences both produced the exact transcript in 1.863 seconds total.
- Graphify updated after implementation.

## Fresh audit findings

### Fixed during the fresh audit

- Removed main-process `executeJavaScript` and replaced it with an allow-listed IPC event.
- Strengthened Content Security Policy; inline scripts are no longer allowed.
- Restricted `open-external` to HTTPS URLs.
- Prevented e2e runs from inheriting real provider API keys.
- Excluded development skills, graphs, tests, logs, and audit documents from packaged applications.
- Removed stale duplicated turn-state test logic.

### Not broken, but not live-tested against external services

- Gemini Live, Groq, OpenRouter, OpenAI, Perplexity, NVIDIA, and Ollama were not called with real user credentials during this audit. Their routing, validation, fallback, and model-discovery paths are covered by contract/mocked tests. Ollama was not running locally.
- Microphone and system-loopback capture require user hardware and OS permissions. Audio processing, IPC, worklet chunking, native resampling selection, VAD, and real Whisper inference were independently exercised.

### Remaining maintenance, not release-breaking

- Overall line coverage is 36.6%; core provider routing is substantially higher, while UI orchestration and external-service branches remain comparatively thin.
- The full development dependency audit still reports issues in packaging tooling, but `npm audit --omit=dev` is clean and the packaged runtime completed successfully.
- Repository-wide Prettier still reports the three supplied audit documents plus pre-existing `AICustomizeView.js` and `MainView.js`; all files changed by this work are formatted.
- Ponytail audit identified `src/assets/lit-all-2.7.4.min.js` and the stale `src/components/index.js` barrel as possible deletions. They were not removed because neither affected correctness and unrelated deletion would enlarge this release diff.

## Final classification

- Falsely implemented items: **none found after remediation**.
- Partially implemented original audit items: **none in product code**.
- Broken modules: **none found in tested scope**.
- Not working modules: **none found in tested scope**.
- External/legal decision remaining: **C-00 GPL/commercial distribution strategy**.
