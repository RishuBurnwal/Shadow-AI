# Shadow-AI — Fixing Plan + Ready-to-Use Implementation Prompt

Repo: `github.com/RishuBurnwal/Shadow-AI`
Companion to: `Shadow-AI_Audit_Report.docx`

This document has two parts:
1. **Plain-language fixing plan** — what's wrong, why, and how to fix it, file by file.
2. **A single copy-paste prompt** (bottom of this doc) you can hand to Claude Code / any coding agent to actually implement the fixes, in order, safely.

---

## Part 1 — Fixing Plan (explained simply)

### Problem 1: Reply feels "late" even after you finish speaking

**Where:** `src/utils/gemini.js`, lines ~568, 589–626

**What's actually happening:** The app opens a Gemini Live session with `responseModalities: [Modality.AUDIO]` and `proactivity.proactiveAudio: true`. That tells Gemini: "generate a full spoken audio reply." But the app **never plays that audio** — there's a comment in the code that literally says the output-audio path is `DISABLED` because Groq is used for the real answer instead. The bug is that the code only fires the fast Groq/OpenRouter answer when `generationComplete` arrives — and `generationComplete` only fires once Gemini finishes generating the audio reply nobody hears. So every single turn, you pay for a full unused text-to-speech generation before your real answer even starts.

**Fix:**
- Stop requesting an audio response you don't use, OR
- Change the trigger from `generationComplete` to the earliest end-of-turn signal (`turnComplete`, or the point where `inputTranscription` stops updating for the active turn) so the Groq call starts the instant you stop talking — not after Gemini finishes talking to itself.
- Add a `console.time`/`console.timeEnd` (behind a debug flag) around "user stopped speaking" → "first answer token" so this is measurable, not just a feeling.

**Why this matters:** this is very likely 60-80% of the perceived "why is it slow" complaint. It costs zero benefit today.

### Problem 2: Speech-to-text is slow and/or inaccurate (local/offline Whisper mode)

**Where:** `src/utils/localai.js`

Two separate issues stack on top of each other:

**2a. End-of-speech detection waits too long.**
`VAD_MODES.VERY_AGGRESSIVE` (the default) requires `silenceFramesRequired: 15`. Frames arrive every 100ms from the renderer, so that's a fixed **1.5 second** wait after your last word before the app even starts transcribing.

**2b. VAD is a crude volume check, not real voice detection.**
`processVAD()` just measures RMS (root-mean-square loudness) and compares it to a fixed number (`energyThreshold: 0.02`). It can't tell your voice apart from a fan, keyboard, or background chatter. Quiet trailing words get missed; noise gets mistaken for speech.

**2c. Transcription is one big batch call, no partial results.**
`transcribeAudio()` waits for the *entire* utterance to be buffered, then sends it to Whisper in one shot. Nothing appears on screen until that single call finishes. On CPU-only machines (no GPU/WebGPU explicitly requested — `device: 'auto'`), that can take several extra seconds for a longer sentence.

**Fix (in priority order):**
1. Replace the RMS-threshold VAD with a proper VAD model — **Silero VAD** is the standard choice: small (~1-2MB), ONNX-based (fits your existing `onnxruntime`/`transformers.js` stack), runs comfortably in real time on CPU, and is dramatically more robust to background noise than a volume threshold.
2. Once Silero VAD is in and tested, shorten `silenceFramesRequired` from 1.5s down to ~400-600ms (a natural conversational pause) — you can only safely shorten this once you trust the VAD not to false-trigger on a breath or a soft "um."
3. Move from "wait, then one big Whisper call" to **rolling-window streaming transcription**: transcribe overlapping ~2-3 second windows *as audio arrives*, show italicized/greyed "partial" text immediately, then replace it with the finalized transcript once VAD confirms the turn actually ended. This is the single biggest perceived-speed win, because the user sees *something* within ~1 second of speaking instead of a blank screen for the whole utterance.
4. Explicitly request the WebGPU backend for Whisper with a CPU fallback, and log which one was actually used, so slow inference is visible in diagnostics instead of silently happening.

**On your SeamlessM4T / SeamlessStreaming suggestion:** this is a reasonable direction and worth evaluating, but with a caveat — SeamlessStreaming is purpose-built for exactly this ("simultaneous" chunk-by-chunk transcription with low first-output latency), but it is **not currently available as a drop-in transformers.js pipeline** the way Whisper is. Realistically it would need to run as a separate Python process (similar to how `SystemAudioDump` is already shelled out to on macOS) communicating with the Electron main process over a local socket/IPC. That's a bigger lift than the Silero VAD + streaming-Whisper approach above. Recommendation: do the VAD + streaming-Whisper fix first (days, not weeks), measure the improvement, and only reach for a SeamlessStreaming sidecar process if local mode is still noticeably behind the cloud (Gemini) path afterward.

### Problem 3: Audio capture uses a deprecated, main-thread API

**Where:** `src/utils/renderer.js` (`createScriptProcessor`, all three mic-setup functions)

`ScriptProcessorNode` is deprecated in the Web Audio spec and runs on the **main UI thread**. Under any UI load (dragging the window, opening a menu), its callbacks can be delayed, dropping or corrupting audio chunks mid-capture — this shows up as random, hard-to-reproduce transcription glitches.

**Fix:** migrate to `AudioWorkletNode`, which runs in a dedicated audio thread isolated from UI work.

### Problem 4: Chunking/transport overhead (smaller, but adds up)

**Where:** `src/utils/renderer.js` (audio chunk send), `src/utils/gemini.js` (IPC handlers)

Already chunks audio at 100ms — good granularity. But each chunk is base64-encoded (~33% size overhead) and sent via `ipcRenderer.invoke` (a full awaited request/response), inside the audio callback. Switch to `ipcRenderer.send` (fire-and-forget) or a `MessagePort`/`SharedArrayBuffer` transfer of raw bytes to cut overhead sitting directly in the latency-critical path.

### Problem 5 (security, found during audit, not asked for but important)

**Where:** `src/storage.js`

API keys (Groq, OpenAI, Gemini, etc.) are written to disk as **plaintext JSON**, with no use of Electron's built-in `safeStorage` (OS keychain-backed encryption). Anyone with file access to the machine can read every configured provider key. Fix: encrypt with `safeStorage.encryptString`/`decryptString`, with a one-time migration for existing plaintext credential files.

### Other findings worth fixing while you're in this code (full list + detail in the audit report)
- No timeout on hosted-provider API calls (`providerRouter.js`) — a stalled request can hang a reply indefinitely with no fallback.
- Answer-pipeline state (`currentTranscription`, `messageBuffer`, conversation history) is global module state instead of scoped per session — risk of state bleeding across reconnects.
- `lint` script is a no-op even though `.prettierrc` exists — wire it to `prettier --check` + ESLint.
- Zero test coverage on the VAD/resample/audio pipeline — the exact area with the bugs above; add unit tests for `resample24kTo16k` and `processVAD` since both are pure, easily-testable functions.
- Verbose logging prints raw transcript content and per-chunk progress dots unconditionally — gate behind a debug flag.

---

## Part 2 — Copy-paste implementation prompt

Paste everything in the box below into Claude Code (or another coding agent) with the Shadow-AI repo open. It's written to be run phase-by-phase so nothing breaks in one giant unreviewable change.

```
You are working in the Shadow-AI repository (Electron desktop assistant: live screen/audio
capture, Gemini Live for cloud STT, local Whisper+Ollama for offline mode, multi-provider
LLM fallback for answers). Read every file you touch fully before editing it. Work in the
phases below, in order. After each phase: run `npm test`, run the app manually if possible,
and summarize exactly what changed and why before moving to the next phase. Do not combine
phases into one commit. Preserve all existing provider-fallback, reconnect, and .env-sync
behavior — those subsystems are already solid; do not refactor them unless a phase below
explicitly asks you to.

=== PHASE 1: Fix reply latency (the "answers late" bug) ===
File: src/utils/gemini.js

1. In initializeGeminiSession(), the Live session config currently requests
   `responseModalities: [Modality.AUDIO]` and `proactivity: { proactiveAudio: true }`,
   but no code anywhere plays or consumes the returned audio — the outputTranscription
   handler is explicitly commented out as "DISABLED... using Groq for faster responses
   instead." Meanwhile, sendToAnswerProvider(currentTranscription) — the function that
   calls Groq/OpenRouter/etc. for the real answer — only fires on the
   `message.serverContent?.generationComplete` event, which only arrives once Gemini
   finishes generating that unused audio.

2. Change the trigger: fire sendToAnswerProvider as soon as the user's turn is known to
   be complete, not when Gemini's own (unused) generation completes. Investigate whether
   `message.serverContent?.turnComplete` fires earlier and reliably indicates end-of-user-
   speech in this SDK version (`@google/genai`); if so, move the sendToAnswerProvider call
   there instead of generationComplete, guarding against firing twice for the same
   transcription. If turnComplete is not reliable as an earlier signal, investigate
   removing/reducing the AUDIO response modality request (e.g., request TEXT modality only,
   or find the config that stops the model from synthesizing a full spoken reply) so
   generationComplete itself arrives faster, since nothing consumes the audio anyway.

3. Add timing instrumentation (behind a DEBUG env var or similar existing flag pattern used
   in this repo) that logs the elapsed time from "last inputTranscription update" to
   "sendToAnswerProvider called" and from there to "first token received," so the fix is
   measurable, not just a feeling. Do not leave this logging on unconditionally in
   production output (see Phase 4 for the existing similarly-noisy logs).

4. Do not change the currentTranscription accumulation logic itself, only the trigger
   point and (if you touch the modality) the session config. Keep behavior identical for
   speaker diarization, reconnection, and all six provider fallbacks.

=== PHASE 2: Fix local/offline STT speed and accuracy ===
File: src/utils/localai.js

1. Replace the RMS-threshold VAD (calculateRMS/processVAD, VAD_MODES) with a real VAD
   model. Use Silero VAD (ONNX format) — it is small, runs in real time on CPU, and is
   compatible with the onnxruntime backend already available via @huggingface/transformers
   in this project. Keep the existing RMS check only as an optional cheap pre-filter to
   skip VAD-model inference on obvious pure silence, if useful for efficiency — but the
   authoritative speech/silence decision should come from the VAD model, not the RMS
   threshold alone.

2. Once the new VAD is in and you've verified (via manual testing or a new unit test) that
   it does not false-trigger on short pauses/breaths, reduce the effective silence-wait
   from the current ~1.5s (15 frames × 100ms) down to roughly 400-600ms. Keep this as a
   named, documented constant, not a magic number.

3. Convert transcription from a single batch call (transcribeAudio() on the whole
   accumulated speechBuffers) into rolling-window streaming: as audio accumulates during
   isSpeaking, periodically (e.g., every ~2 seconds) run Whisper on the audio-so-far and
   emit an interim/partial transcript via sendToRenderer, clearly marked as provisional
   (e.g., a new IPC channel or a flag on the existing update-response-style event so the
   renderer can style it distinctly, such as lower opacity). When VAD confirms end-of-
   speech, run one final transcription pass on the complete buffer and replace the partial
   text with the finalized result before calling the existing downstream answer logic.
   Keep the existing minimum-audio-length guard (handleSpeechEnd's 16000-byte check).

4. In loadWhisperPipeline(), explicitly attempt device: 'webgpu' first, catching failure
   and falling back to the current 'auto'/CPU behavior, and log (at startup, once, not
   per-chunk) which backend was actually selected so this is visible in the existing
   safe-diagnostics command (launcher option 8 in main.py) if that's wired to read app
   logs — check main.py to see how diagnostics are assembled and add this there if
   appropriate.

5. Do not change the Ollama answer-generation path (initializeLocalSession, the chat call
   logic) — only the VAD and transcription steps above.

=== PHASE 3: Fix deprecated audio capture ===
File: src/utils/renderer.js

1. Replace all three uses of `audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1)` /
   `micAudioContext.createScriptProcessor(...)` with an AudioWorkletNode-based pipeline:
   create a small AudioWorkletProcessor module that receives Float32 audio in its
   `process()` method, converts and chunks it identically to the current
   convertFloat32ToInt16 + samplesPerChunk logic, and posts PCM chunks back to the main
   renderer thread via its port instead of the onaudioprocess event.
2. Preserve the existing chunk duration (AUDIO_CHUNK_DURATION = 0.1s) and the existing
   IPC channel names/payload shape (`send-audio-content`, `send-mic-audio-content`) so
   main-process code in gemini.js does not need to change.
3. Test capture still works identically on the platform you're building for (Windows is
   the primary verified platform per the README); note in your summary if AudioWorklet
   support needs any Electron/Chromium version check.

=== PHASE 4: Security — encrypt stored credentials ===
File: src/storage.js

1. Wrap all credential persistence (wherever API keys are read from/written to the
   on-disk JSON file, including setApiKey/setCredentials and the general getCredentials
   read path) with Electron's `safeStorage.encryptString` / `safeStorage.decryptString`.
2. On startup, detect existing plaintext credential files from before this change (they
   will fail to decrypt / won't have the expected encrypted-blob shape) and migrate them
   in place: read the plaintext values once, re-write them encrypted, and never write
   plaintext again. Do not lose a user's existing configured keys during this migration.
3. Continue redacting keys from logs/diagnostics/notifications exactly as already done —
   this phase is about encryption at rest, not about the existing redaction-in-logs
   behavior, which should be left alone.

=== PHASE 5: Robustness cleanup ===
1. src/utils/providerRouter.js — add an AbortController-based timeout (8-10s, as a named
   constant) around each hosted-provider request so a stalled network call fails over to
   the next provider instead of hanging indefinitely. Ensure this triggers the existing
   onProviderFailure callback path used by streamWithFallback.
2. src/utils/gemini.js — refactor currentTranscription, messageBuffer, and
   groqConversationHistory from module-level globals into state scoped to each
   initializeGeminiSession() call (e.g., a small session-state object created per call
   and closed over by that session's callbacks), so a reconnect cannot let stale state
   from a previous session leak into a new one. Keep external behavior identical.
3. package.json — change the `lint` script from the current no-op echo to actually run
   `prettier --check .`; if adding ESLint, use a minimal recommended config and fix only
   what it flags as actual bugs (not stylistic churn) in this pass.
4. Gate the verbose logging in src/utils/gemini.js (the full-payload console.log on every
   Live message, and the per-chunk process.stdout.write('.')/(',')) behind a DEBUG flag
   that defaults to off, consistent with how other debug/verbose behavior in this repo is
   already flagged (check providerEnv.js / .env handling for the existing pattern before
   inventing a new one).

=== PHASE 6: Tests ===
Add unit tests (following the existing style in test/*.test.js, using node --test) for:
1. resample24kTo16k in localai.js — feed known input sample arrays, assert exact or
   near-exact output sample values.
2. The VAD state machine (processVAD or its Silero-based replacement from Phase 2) —
   feed synthetic speech/silence RMS or model-score sequences, assert isSpeaking
   transitions and that handleSpeechEnd fires at the right point.
3. The corrected answer-trigger logic from Phase 1 — mock a Live session's message
   callbacks and assert sendToAnswerProvider is called on the new (earlier) trigger
   event, not on generationComplete.

After each phase, report: files changed, what was tested, what still needs manual
verification (e.g., anything requiring real microphone hardware or a live API key), and
any risk or regression you're not fully confident about. Stop and ask before proceeding to
the next phase if a change in the current phase touches code outside the file(s) listed
for it.
```
