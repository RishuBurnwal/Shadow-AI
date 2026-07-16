# Shadow AI — Full Repository Audit Report
Repo audited: `RishuBurnwal/shadow-ai` (GitHub, single squashed commit `bc0dd0f`)
Audit date: 2026-07-16 · Files inspected: package.json, LICENSE, main.py, src/index.js, src/preload.js, src/storage.js, src/memory.js, src/soul.js, src/audioUtils.js, src/audio/audio-chunk-processor.js, src/utils/{gemini,localai,renderer,window,sileroVad,providerRouter,providerEnv,providers.config,cloud,prompts,passthrough}.js, src/skills/*, test/*, e2e/*, forge.config.js

---

## 0. READ THIS FIRST — Critical, Non-Technical Blocker

Before any code fix, this blocks commercialization and needs a decision:

**Finding C-00 — This is very likely a rebrand of a third-party GPL-3.0 project, not an original codebase.**

- `package.json` → `"author": { "name": "sohzm", "email": "sohambharambe9@gmail.com" }`, `"license": "GPL-3.0"`. This is **not** Rishu Burnwal's identity — it's the original author of `sohzm/cheating-daddy`, a well-known open-source Electron app ("a free and opensource app that lets you gain an unfair advantage") with the same core concept: Electron overlay + screen/audio capture + Gemini Live + local Ollama/Whisper fallback + multiple interview/meeting "profiles."
- The architecture, dependency set (`@google/genai`, `ollama`, `onnxruntime-node`, `@huggingface/transformers`, `lit`, Electron Forge makers), and feature list (stealth overlay, VAD, speaker diarization, local Whisper fallback, resume sync, STAR-method answer skill) line up closely with that lineage (`cheating-daddy` and its known forks/rewrites).
- The repo ships only **one squashed commit**, so there's no visible commit history proving independent authorship or a clean fork lineage.

**Why this matters for your monetization plan:**
1. **GPL-3.0 is a copyleft license.** If this codebase (or a substantial derivative of it) is distributed to paying users, GPL-3.0 obligates you to: (a) keep the whole work under GPL-3.0, (b) make complete corresponding source available to every recipient, (c) not add further restrictions (a closed-source "subscription license key" gate that blocks access to features is legally very hard to reconcile with GPL-3.0's requirement that recipients can run, study, modify, and redistribute the software). A pure server-verified license-key paywall on top of GPL-3.0 code is a common real-world pattern people attempt, but it does **not** make the underlying code closed-source — anyone who receives the binary is still entitled to the source and to modify/redistribute it, license key or not.
2. **The author attribution was not changed.** Shipping someone else's GPL project under a different author's name/branding without preserving their copyright notices and license text is both a license violation (GPL-3.0 §4/§5 require preserving copyright/license notices) and, separately, a misrepresentation-of-authorship problem.
3. **"Open origins" risk to the business itself**: if you build a paid product on this without resolving the above, the biggest risk isn't hypothetical — it's that the original author or license terms surface publicly (GitHub topic pages, DeepWiki docs, blog posts already index this lineage, as your own project's public issue trackers/forks would too) and you have to unwind pricing, take down installers, or relicense under pressure.

**This is factual/legal-context information, not legal advice — I'm not a lawyer.** Concretely, before writing another line of product code, resolve one of these three paths:
- **Path A — Stay GPL-3.0, monetize services not code.** Keep it fully open-source (proper attribution restored), and charge for a *hosted/cloud backend*, support, managed API keys, or a hosted license-verification + telemetry service that isn't itself part of the GPL'd binary. This is the standard "open-core via SaaS" pattern and is the lowest-risk path.
- **Path B — Get a relicensing agreement from the original author.** Contact the original author (email is literally in your own `package.json`) and negotiate a dual-license or commercial license grant. Until you have that in writing, treat the codebase as GPL-3.0-only.
- **Path C — Rewrite the gated/paid portions from scratch.** Keep GPL-3.0 code as the free core, and build genuinely new, independently-written modules (the license server, the paid feature set, the new STT pipeline described below) as a **separate process/service** that communicates over an API boundary — not linked into the GPL binary — so it isn't automatically a "derivative work." This still needs a lawyer to confirm the boundary is clean (GPL's definition of "derivative" is broader than many developers assume — dynamic linking, shared address space, and tight coupling can all count).

Fix everything below independent of which path you choose — but **do not ship a paid build until C-00 is resolved**, because it's a legal and reputational risk that no amount of code quality fixes anything about.

---

## 1. Architecture Overview (as-built)

```
main.py (Windows launcher, optional)
  └─ spawns Electron app (src/index.js = main process)

src/index.js (Electron main process)
  ├─ src/utils/window.js      → BrowserWindow creation, IPC wiring
  ├─ src/storage.js           → config/credentials persistence (safeStorage-backed)
  ├─ src/memory.js            → long-term "memory" store
  ├─ src/soul.js              → persona/system-prompt shaping
  ├─ src/skills/*             → resumeSync, starAnswer, skillRegistry
  └─ src/utils/
       ├─ gemini.js           → CLOUD path: Gemini Live API (audio in, text transcript out,
       │                         turnComplete/generationComplete-driven turn taking),
       │                         then routes the transcript to an "answer provider"
       │                         (Groq / OpenRouter / etc.) for the actual reply text —
       │                         Gemini's own audio reply is intentionally discarded (see F-01)
       ├─ localai.js          → LOCAL/offline path: RMS + Silero VAD → rolling-window
       │                         Whisper (transformers.js/ONNX) transcription → Ollama reply
       ├─ sileroVad.js        → Silero VAD v5 ONNX model loader + frame-level inference
       ├─ providerRouter.js / providerEnv.js / providers.config.js → multi-provider routing
       ├─ cloud.js            → cloud passthrough/relay helper
       ├─ renderer.js         → renderer-side orchestration (mic capture, IPC, UI state)
       └─ prompts.js          → system prompt templates per "profile"

src/audio/audio-chunk-processor.js → AudioWorkletProcessor: Float32→Int16 PCM,
                                       100 ms chunks, posted to renderer via transferable buffer
```

Two independent "brains" exist side by side: a **cloud pipeline** (Gemini Live) and a **local/offline pipeline** (Whisper + Ollama). Your complaint about slow/incorrect speech-to-text is almost certainly about the **local pipeline**, because the cloud pipeline already delegates STT to Gemini Live's native streaming transcription. Both are audited below.

---

## 2. Findings — Speech-to-Text & "Instant Reply" Latency (your stated priority)

### F-01 (Critical/Fixed-in-repo, verify) — Cloud path was gated behind unused audio synthesis
Already flagged in-code (`gemini.js` line ~811): requesting Gemini's `AUDIO` response modality caused Gemini to synthesize a spoken reply before signaling `generationComplete`, which delayed the real (text) answer that your app actually uses. The comment says this was removed. **Action:** confirm `config.tools`/response modality in the live `client.live.connect()` call never re-requests `AUDIO`, and add a regression test asserting only `TEXT`/transcription-only config is sent (there's no such assertion in `test/shadow-ai-contract.test.js` today — add one).

### F-02 (High) — Turn-taking relies on two racing, redundant server signals with fragile state machine
In `gemini.js`, `turnComplete` and `generationComplete` both mutate `s.answerFired`, `s.transcription`, `s.messageBuffer`, and `s.turnStart` with slightly different reset semantics (turnComplete does *not* reset `s.turnStart`/`s.lastInputTime`; generationComplete does). If `generationComplete` arrives without a prior `turnComplete` (documented as a known fallback case in the code itself), the *next* turn's `s.turnStart` timer starts from stale state, corrupting your own `[SHADOW_DEBUG] Input complete → answer call` latency metric and, in edge cases, causing the barge-in detector (`s.answerFired && !s.messageBuffer`) to fire against the wrong turn.
**Fix:** Replace the two independent boolean/string flags with one explicit turn-state enum (`IDLE → LISTENING → AWAITING_ANSWER → STREAMING → IDLE`) and a single reducer function that both events go through, so "what happens on turnComplete" and "what happens on generationComplete" can't silently diverge. This directly affects "instant reply" correctness, not just speed.

### F-03 (High) — Local Whisper path re-transcribes the *entire* utterance from scratch every 2 seconds
`localai.js`: `ROLLING_WINDOW_MS = 2000`, and `startRollingTranscription()` calls `transcribeAudio(Buffer.concat(speechBuffers))` — i.e., **all** audio accumulated since speech started, every single rolling window, with no caching of prior partial results and no incremental/streaming decode. For a 20-second answer, by second 20 you're re-running Whisper over 20 seconds of audio just to get an interim caption, and CPU/webgpu cost grows roughly quadratically with utterance length over the session. This is very likely the "STT is late" symptom you're seeing, especially on longer questions.
**Fix:** see the Fixing Plan doc (§2) — switch to true incremental/streaming decoding with a bounded lookback window, not full-buffer reprocessing.

### F-04 (High) — Single global Whisper pipeline instance with an in-flight mutex serializes everything
`whisperPipeline` is a single module-level object; `_isTranscribing` is used as a manual mutex so rolling transcription and final transcription never overlap (`P1-02 guard`). This is *correct* for avoiding native-binding crashes, but it means: while a rolling partial transcription is running, the **final** transcription for speech-end has to wait for it to finish before starting (`handleSpeechEnd` explicitly awaits the in-flight guard). On a slow CPU-backed session, this can add the remainder of a 2-second rolling window as pure dead time right when the user stops talking — the worst possible moment for a latency hit.
**Fix:** cancel/abort the in-flight rolling transcription (don't wait for it) the instant speech-end is detected, and immediately kick off the final transcription. Whisper via transformers.js doesn't support true cancellation mid-inference, so the practical fix is to shrink the rolling window's max audio length so no single rolling call can run long enough to matter (see Fixing Plan).

### F-05 (Medium) — Turn-end (silence) detection is a single hardcoded aggressive preset
`vadConfig = VAD_MODES.VERY_AGGRESSIVE` is hardcoded (`localai.js` line 59) → 5 consecutive 100 ms-silence frames (500 ms) ends the turn. This is not exposed to Settings UI (confirm — grep found no UI binding for `vadConfig` outside this file). 500 ms is fine for fast talkers but will cut off users who pause mid-sentence to think — a real "incorrect/cut-off transcription" complaint waiting to happen, independent of Whisper's accuracy.
**Fix:** expose silence-timeout as a user-facing slider (300 ms–1200 ms) and persist it in `storage.js` preferences, same as other tunables already are.

### F-06 (Medium) — Naive linear resampler (24kHz→16kHz) with no anti-aliasing filter
`resample24kTo16k()` in `localai.js` does linear interpolation only. Without a low-pass/anti-alias filter before downsampling, this introduces aliasing artifacts that measurably hurt Whisper accuracy on sibilant sounds (s/sh/f) and can be a real contributor to "STT is wrong" beyond raw latency. Cloud path avoids this because Gemini Live's `inputAudioTranscription` operates on the original 24kHz PCM (confirm capture rate matches Gemini's expected input rate).
**Fix:** either capture directly at 16kHz for the local path (avoid resampling entirely — set `SAMPLE_RATE` in the AudioWorklet to 16000 for local mode), or use a proper polyphase/FIR resampler.

### F-07 (Medium) — "Reply is not instant" is architecturally two round trips even on the cloud path
Cloud flow is: mic → Gemini Live (ASR) → `turnComplete` → **new** call to a separate answer provider (Groq/OpenRouter/etc. via `sendToAnswerProvider`) → stream that response back. That second hop (a fresh HTTP/WS connection + cold model inference from a different provider) is inherently added latency versus a single end-to-end pipeline. This was clearly a deliberate speed trade-off already (comment: "the actual answer comes from Groq/OpenRouter/etc. for speed" — because Gemini Live's own generation was slower/gated). Whether that trade-off is still net-positive depends on which "answer provider" is actually configured; if it's a cold-starting or rate-limited endpoint, this hop can dominate total latency.
**Fix:** instrument and log (not just in debug mode) the two legs separately — `t_transcription_ready → t_answer_first_token` and `t_answer_first_token → t_answer_complete` — so you have real numbers before optimizing further. Right now the only timing instrumentation (`[SHADOW_DEBUG] Input complete → answer call`) is gated behind `isDebug` and only measures leg 1.

### F-08 (Low) — No visible network-level chunked upload for cloud audio
Cloud audio chunks (100 ms, sent via `send-audio-content` IPC channel from the AudioWorklet, per `audio-chunk-processor.js`) already look correctly chunked at the *capture* layer. Whether `gemini.js` sends each 100 ms chunk to the Live API immediately (true streaming) or buffers them client-side before an upload was not fully confirmed within this pass — verify `session.sendRealtimeInput`/equivalent is called per-chunk, not batched, since batching would silently reintroduce the latency you're trying to eliminate.

---

## 3. Findings — Security

### S-01 (Critical) — `nodeIntegration: true` + `contextIsolation: false`
`src/utils/window.js`: `nodeIntegration: true, contextIsolation: false`. This gives the renderer (the web page/UI layer) full, unsandboxed Node.js access — `require('fs')`, `require('child_process')`, etc. — directly from any script that runs in that window. Combined with `marked` (Markdown→HTML rendering of AI output) and `highlight.js` in the dependency tree, any prompt-injected or AI-generated content that gets rendered as HTML without careful sanitization is a potential path to **remote code execution**, not just XSS. This is the single highest-severity finding in the repo.
**Fix:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and move every Node/Electron API the renderer needs behind an explicit `contextBridge.exposeInMainWorld` allowlist in `src/preload.js` (currently 4KB — check it isn't already doing this partially; if it is, the window.js flags are dead-weight risk and should be flipped regardless). This is real refactor work (every `require(...)` call currently made from renderer code has to move to IPC calls), budget it as its own workstream, not a one-line fix.

### S-02 (High) — AI output rendered via `marked` — verify HTML sanitization
If `marked`'s output is inserted via `innerHTML` anywhere in the renderer (common pattern for chat UIs) without a sanitizer (e.g., DOMPurify) in between, and given S-01's contextIsolation is off, a malicious/compromised answer-provider response or a prompt-injection payload embedded in captured screen/audio content could execute arbitrary renderer-context JS — which, combined with S-01, is arbitrary Node code.
**Fix:** confirm/insert DOMPurify (or equivalent) sanitization between `marked.parse()` and DOM insertion, everywhere it happens.

### S-03 (Medium) — Model downloads verified by SHA-256, but only for Silero VAD
`sileroVad.js` does this well (pinned URL, checksum verification, redirect cap). Confirm the Whisper model download path (`@huggingface/transformers` pipeline loader, `loadWhisperPipeline`) has equivalent integrity verification — from the code read, model fetching there is delegated entirely to the `transformers.js` library's own cache/download logic with no visible checksum pinning in this codebase. If `transformers.js` doesn't verify checksums itself, a compromised or MITM'd Hugging Face Hub response could substitute a malicious ONNX model.

### S-04 (Medium) — API keys / credentials storage
`storage.js` uses Electron's `safeStorage` (OS keychain-backed encryption) when available, with a fallback path when not (`_safeStorage` can be null). **Verify the fallback path doesn't silently store credentials in plaintext** when `safeStorage` is unavailable (common on some Linux configs without a secret-service provider) — this should hard-fail or warn loudly rather than degrade silently.

### S-05 (Low) — Dependency currency
`electron ^30.0.5` — confirm this is patched against known Electron CVEs at time of release; Electron ships frequent security patches and ^30 is a fairly old major by mid-2026. Run `npm audit` and update the Electron major version as part of any pre-launch hardening pass; do this in a dedicated branch since major Electron bumps can break native module ABI compatibility (`onnxruntime-node`, `@huggingface/transformers` both ship native bindings).

---

## 4. Findings — Architecture, Reliability, Code Quality

### A-01 (Medium) — Reconnect logic exists but session/turn state recovery after reconnect is unverified
`gemini.js` has `attemptReconnect()` / `MAX_RECONNECT_ATTEMPTS` and preserves `groqHistory` across reconnects (`isReconnect` branch). Confirm in-flight turn state (`s.transcription`, `s.answerFired`) is safely reset on reconnect so a dropped connection mid-turn doesn't leave the UI stuck on "Listening..." forever or double-fire an answer for a partial transcript.

### A-02 (Medium) — Two parallel VAD implementations with different tuning
`sileroVad.js` (used by both paths as the "real" classifier) plus a separate RMS pre-filter + differently-thresholded `VAD_MODES` presets in `localai.js`. This is reasonable as a 2-stage filter (cheap RMS gate before expensive ONNX inference) but means VAD behavior tuning has to happen in two places that can drift out of sync. Document the interaction explicitly (a code comment cross-referencing both files) so future contributors don't "fix" one without the other.

### A-03 (Low) — `main.py` Windows launcher: readiness polling, not push-based
`wait_for_readiness()` polls for a marker file within a 12s `STARTUP_TIMEOUT`. This is fine functionally but adds a launcher-side blind spot — if Electron takes >12s to start on a slow machine (first-run model downloads for Whisper/Silero are multi-hundred-MB), the launcher may report failure while the app is actually still starting. Consider making the timeout adaptive/extendable when a "downloading model" IPC signal is observed, or at minimum surface a distinct "still downloading models, this is normal" message rather than a generic timeout.

### A-04 (Low) — Test coverage exists but is thin relative to claimed scope
`test/` has 5 files (audio-pipeline, config-migration, provider-env, provider-router, shadow-ai-contract) plus `vad-processor.test.js` and one Playwright e2e smoke test. This is a reasonable start but does **not** cover: the turn-state reducer (F-02), the rolling-transcription cancellation path (F-04), or the Electron security flags (S-01) as a static assertion. Recommend adding a lint/test rule that fails CI if `nodeIntegration: true` or `contextIsolation: false` ever appears in `window.js`, so S-01 can't silently regress even after you fix it once.

---

## 5. Prioritized Issue Table

| ID | Title | Severity | Area |
|---|---|---|---|
| C-00 | GPL-3.0 provenance / authorship not resolved | **Blocker** | Legal |
| S-01 | `nodeIntegration:true`/`contextIsolation:false` | Critical | Security |
| F-01 | Verify AUDIO-modality gating fix is complete | Critical (verify) | Latency |
| F-03 | Whisper full-buffer re-transcription every 2s | High | Latency/STT |
| F-04 | Rolling transcription blocks final transcription | High | Latency/STT |
| S-02 | Unsanitized Markdown → HTML render path | High | Security |
| F-02 | Fragile dual-signal turn-state machine | High | Correctness |
| F-05 | Hardcoded aggressive silence timeout | Medium | STT accuracy |
| F-06 | No anti-alias filter in resampler | Medium | STT accuracy |
| F-07 | Two-hop cloud latency not instrumented in prod | Medium | Latency |
| S-03 | Whisper model integrity unverified | Medium | Security |
| S-04 | Credential fallback storage path unverified | Medium | Security |
| A-01 | Reconnect turn-state recovery unverified | Medium | Reliability |
| A-02 | Dual VAD tuning drift risk | Medium | Maintainability |
| S-05 | Electron/dependency currency | Low | Security |
| A-03 | Launcher fixed timeout vs. model downloads | Low | Reliability |
| A-04 | Missing regression tests for above | Low | QA |
| F-08 | Confirm true per-chunk streaming to Gemini | Low (verify) | Latency |

See **`02_FIXING_PLAN_AND_PROMPT.md`** for the concrete implementation plan (including your SeamlessM4T/streaming-chunk suggestion, evaluated against what's already implemented) and **`03_ENHANCEMENTS_AND_ROADMAP.md`** for future-proofing and new feature ideas.
