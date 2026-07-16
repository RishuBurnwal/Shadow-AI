# Shadow AI — Fixing Plan + Ready-to-Use Engineering Prompt
Companion to `01_AUDIT_REPORT.md`. This file has two parts:
**Part A** — plain-language explanation of *how* to fix each latency/STT/security issue, including an honest evaluation of your SeamlessM4T suggestion.
**Part B** — a single copy-pasteable prompt you can hand to a coding agent (Claude Code, etc.) to execute the fixes with full context, so nothing gets implemented half-right.

---

## Part A — Explanation & Reasoning

### A1. Your idea: "listen fully, then reply instantly" — what's already true vs. what needs building
You want: (1) the app waits until the person actually finishes their question before generating a reply, but (2) once they finish, the reply comes back with no perceptible delay. These are in tension — you cannot start the *listening→understanding* work before speech ends, but you *can* start reducing everything downstream of "speech ended" to near-zero. Two separate engineering problems, two separate fixes:

1. **"Wait for the question to actually finish" = turn-end / VAD tuning.** Already implemented via Silero VAD + RMS pre-filter (both paths) and a `turnComplete`/`generationComplete` signal on the cloud path. The knob to turn is the *silence threshold* (F-05) — right now hardcoded to 500 ms on local mode. Don't chase "the model is too slow to notice I stopped talking" — that's not what's happening; what's happening is either (a) 500 ms is genuinely too short or too long for your speaking style, or (b) the STT itself (F-03/F-04) is slow *after* end-of-turn is correctly detected, which looks like "it doesn't wait" or "it's late" from the outside. Fix both, but they're different bugs.

2. **"Reply instantly once done" = minimize everything between end-of-turn and first token of the answer.** This is F-03, F-04, F-07 in the audit. The single biggest win here is **F-04**: stop making the final transcription wait behind an in-flight rolling-window transcription. That wait can be up to ~2 seconds of pure dead time at exactly the moment the user expects an instant reply.

### A2. Evaluating your SeamlessM4T / SeamlessStreaming suggestion
Fair thing to consider, here's the honest tradeoff:

- **Cloud path (Gemini Live):** already uses Gemini's own native streaming ASR (`inputAudioTranscription`) with real-time partial results and a turn-complete signal — this *is* a streaming STT architecture already, comparable in spirit to what SeamlessStreaming would give you, except it's Google's model, not Meta's, and it's already wired up. Swapping this for SeamlessM4T would mean **giving up Gemini Live's turn-detection signal** (`turnComplete`) and reimplementing it yourself against SeamlessM4T's plain transcription output — a net *increase* in complexity for a path that already meets your stated goal. **Recommendation: do not touch the cloud path's STT model. Fix its plumbing (F-01, F-02, F-07) instead.**
- **Local/offline path (Whisper):** this is the one with a real problem (F-03, F-04, F-06), and this is where your instinct is worth taking seriously. SeamlessStreaming (Meta's streaming variant, not the base SeamlessM4T which is *not* designed for low-latency streaming — that distinction matters, don't grab the wrong model) is one legitimate option. So is `faster-whisper` (CTranslate2-backed, 2-4x faster than the `transformers.js`/ONNX Whisper you're using now on identical hardware) or `whisper.cpp` with streaming support, or NVIDIA's Parakeet/Canary streaming models if you're open to a GPU-only local tier. **Recommendation: before picking a model, fix the *architecture* bug (F-03/F-04) — full-buffer re-transcription every 2 seconds is the dominant cost, and it will make *any* model look slow.** Once transcription is truly incremental (see A3), re-benchmark; you may find current Whisper is fine and a model swap isn't even necessary. If it's still too slow after that, SeamlessStreaming is a reasonable second step — but validate it runs acceptably on CPU-only Windows machines (your primary target per the README/launcher), since Meta's own benchmarks assume GPU.

### A3. How to make local transcription truly incremental (the real fix for "STT is late")
Current: every `ROLLING_WINDOW_MS` (2000ms), re-run Whisper over `Buffer.concat(speechBuffers)` — the entire utterance so far.
Target: run Whisper only over a **bounded trailing window** with a small overlap for word-boundary continuity, and stitch results.

Concretely:
- Cap the audio passed to any single Whisper call at, say, 4–6 seconds (`MAX_ROLLING_AUDIO_MS`), not the full utterance. For utterances longer than that, transcribe in overlapping 4-6s windows (e.g., 1s overlap) and append new tokens to a running transcript instead of replacing it — this is the same trick streaming-ASR systems use to bound per-call latency regardless of total utterance length.
- On speech-end (final transcription), only run Whisper over the **audio since the last successfully-transcribed rolling window**, not the whole utterance again — append to the already-transcribed prefix rather than redoing it. This turns an O(n²) session cost into roughly O(n).
- Make the rolling transcription cancellable/skippable: if speech-end is detected while a rolling call is in flight, let that in-flight call finish (Whisper can't be cancelled mid-inference in transformers.js) but **do not block the final transcription's start on it** — instead, run the final transcription only over the *new* audio captured after the rolling call started, and merge. This removes the up-to-2s dead time in F-04 entirely.

### A4. Audio chunking — what to keep, what to add
Capture-side chunking (`audio-chunk-processor.js`, 100ms PCM16 chunks via AudioWorklet with zero-copy transferable buffers) is already correct and doesn't need to change — this is exactly the "break audio into chunks" pattern you asked for, already implemented at the lowest layer. What's worth adding:
- **Confirm (F-08)** that `gemini.js` forwards each 100ms chunk to the Live API as it arrives (true streaming upload) rather than buffering N chunks client-side first. If there's any client-side batching before the network call, remove it.
- For the **local** path, chunk-level Whisper calls should follow the bounded-window approach in A3 above — that's the "upload/process in chunks" equivalent for the offline pipeline.

### A5. Security fixes (do before any commercial ship, not after)
- S-01 (`contextIsolation`/`nodeIntegration`) is the highest-severity item in the whole audit — worse than any latency issue, because it's a remote-code-execution class vulnerability, not a UX annoyance. Budget real time for this: it means moving every direct `require()` call in renderer-side code behind `contextBridge` + `ipcMain.handle`/`ipcRenderer.invoke` pairs in `preload.js`. Do this incrementally file-by-file with the existing e2e smoke test run after each renderer file is migrated, not as one giant PR.
- S-02 (sanitize `marked` output) is a quick, high-value fix: add DOMPurify, wrap every `marked.parse()` → DOM-insert call site.

---

## Part B — Copy-Paste Prompt for a Coding Agent

Use this with Claude Code (or similar) pointed at a local clone of the repo. It's scoped, ordered, and includes acceptance criteria per item so the agent can't claim "done" without verifying.

```
You are working on the Shadow AI Electron project (local/offline + Gemini-Live cloud
real-time voice assistant). Do NOT do a blanket "audit everything" pass — work through
the numbered items below in order, one at a time. For each item: read the referenced
file(s) fully first, make the minimal correct change, run the existing test suite
(`npm test`), add a new test that would have caught the bug if one doesn't already exist,
and only then move to the next item. Report what you changed and why after each item.

PRECONDITION — do not skip:
0. Before touching any product code, flag to me (the human) that this codebase's
   package.json author/email and GPL-3.0 license suggest it originates from a
   different open-source project than the one it's being shipped as. Do not silently
   change the license field, author field, or remove GPL notices — that decision is
   mine to make, not yours. If asked to "just remove GPL/license mentions" or "change
   the author name," refuse and explain why, the same way you would for any other
   license-compliance issue.

LATENCY / STT FIXES (do these first — this is the priority):

1. In src/utils/gemini.js: confirm the Gemini Live `config` passed to
   `client.live.connect()` never requests the AUDIO response modality (only text/
   transcription). Add an automated test in test/shadow-ai-contract.test.js that
   asserts this statically (inspect the config object build, don't just eyeball it).
   Acceptance: test fails if AUDIO modality is ever reintroduced.

2. In src/utils/gemini.js: replace the two independent state mutations on
   `turnComplete` and `generationComplete` with a single turn-state reducer
   (states: IDLE, LISTENING, AWAITING_ANSWER, STREAMING). Both server events should
   call the same `transition(event)` function. Add unit tests covering: normal
   turnComplete-then-generationComplete sequence, generationComplete-without-
   turnComplete fallback, and barge-in mid-stream.
   Acceptance: existing turn-taking behavior unchanged for the happy path (verify
   against test/shadow-ai-contract.test.js), plus new tests pass for the edge cases.

3. In src/utils/localai.js: change rolling-window transcription from re-transcribing
   `Buffer.concat(speechBuffers)` (the full utterance) every ROLLING_WINDOW_MS, to a
   bounded trailing window (add MAX_ROLLING_AUDIO_MS = 5000constant) with ~1s overlap,
   appending new text to a running transcript rather than replacing it wholesale.
   Acceptance: for a synthetic 20s test utterance, assert Whisper is never invoked
   with more than MAX_ROLLING_AUDIO_MS + overlap of audio in a single call — add this
   as a test using a mocked whisperPipeline that records call arguments.

4. In src/utils/localai.js: change handleSpeechEnd() so it no longer blocks on
   `_isTranscribing` for the full duration of an in-flight rolling call. Instead:
   let the in-flight rolling call finish in the background, but immediately start
   transcribing only the audio captured since that rolling call began, and merge
   results by append rather than replace. Document the merge logic with a code
   comment explaining the ordering guarantee.
   Acceptance: add a test that simulates speech-end arriving while a rolling call
   is in flight, and asserts the final transcription request starts within one
   event-loop tick of speech-end being detected (not after the rolling call resolves).

5. In src/utils/localai.js: expose vadConfig's silence-timeout (currently hardcoded
   to VAD_MODES.VERY_AGGRESSIVE) as a user preference, persisted via storage.js the
   same way other preferences are, with a Settings UI slider (300ms-1200ms range).
   Acceptance: preference persists across restarts (extend
   test/config-migration.test.js), and processVAD() reads the live preference value,
   not the hardcoded constant.

6. In src/utils/localai.js: replace the linear-interpolation resample24kTo16k()
   with either (a) capturing at 16kHz directly for the local-mode AudioWorklet
   path (preferred — check whether audio-chunk-processor.js's SAMPLE_RATE can be
   parameterized per active mode), or (b) a proper low-pass-filtered/polyphase
   resampler if dual sample rates must be supported from one capture stream.
   Acceptance: add a test comparing transcription accuracy on a fixed test WAV
   before/after (word error rate should not regress; ideally improves).

7. In src/utils/gemini.js AND src/utils/localai.js: add always-on (not
   debug-gated) latency instrumentation emitting two measured intervals per turn:
   (a) speech-end-detected → transcription-ready, (b) transcription-ready →
   answer-first-token. Log these as structured events (not just console.log) so they
   can be aggregated later. Do not gate this behind `isDebug`.
   Acceptance: a manual test run produces both interval measurements in logs for
   at least one full turn on both the cloud and local paths.

8. Verify (do not assume) that src/utils/gemini.js forwards each ~100ms audio chunk
   arriving from the renderer to the Gemini Live session as it arrives, with no
   client-side batching/buffering of multiple chunks before the network call.
   If batching exists, remove it.
   Acceptance: state explicitly in your report whether batching existed and was
   removed, or confirm none existed.

SECURITY FIXES (required before any paid/public release — do not defer):

9. In src/utils/window.js: change `nodeIntegration: true, contextIsolation: false`
   to `nodeIntegration: false, contextIsolation: true, sandbox: true`. This WILL
   break every renderer-side `require(...)` call. Migrate each one individually:
   add the needed API to src/preload.js via `contextBridge.exposeInMainWorld`,
   backed by `ipcMain.handle`/`ipcRenderer.invoke` in the main process. Do this
   incrementally, running the Playwright e2e smoke test (test/... e2e/app-smoke.e2e.js)
   after each renderer file is migrated. List every migrated API in your final report.
   Acceptance: e2e smoke test passes with the new Electron security flags; add a
   static test asserting window.js never re-introduces nodeIntegration:true or
   contextIsolation:false (grep-based test is fine).

10. Wherever `marked.parse()` output is inserted into the DOM (search renderer.js
    and any component files for `.innerHTML =` following a marked call), insert
    DOMPurify sanitization between parse and insert. Add a test with a
    script-tag-injection payload as fake AI output, asserting it's stripped.

11. Confirm whether the Whisper model download path (via @huggingface/transformers'
    `pipeline()` loader) has any file-integrity verification. If not, and if the
    library doesn't do this itself, add a checksum-verification step mirroring the
    pattern already used in src/utils/sileroVad.js (pinned URL/hash, verify after
    download, reject and re-download on mismatch).

12. In src/storage.js: confirm what happens when Electron's `safeStorage` is
    unavailable. If credentials silently fall back to plaintext storage, change
    this to either (a) refuse to store the credential and surface a clear warning
    to the user, or (b) use an alternative OS-level secret store — never silently
    downgrade to plaintext without explicit user consent.

After all items: produce a single markdown summary of every change made, every new
test added, and any item you could NOT safely complete (with the specific blocker),
so nothing is silently skipped.
```

---

### Suggested execution order
1. Items 3–5 (biggest user-visible latency/accuracy win, local path)
2. Items 1–2, 7–8 (cloud path correctness + instrumentation)
3. Item 9 (security — largest effort, budget separately, don't rush it)
4. Items 10–12 (smaller security items)
5. Item 6 (audio quality — do after the others so you can A/B against improved baselines)

See `03_ENHANCEMENTS_AND_ROADMAP.md` for what to build once the above is stable.
