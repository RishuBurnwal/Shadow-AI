# Shadow AI — Fixing Plan + Coding-Agent Prompt — File 3 of 6

**Read after:** File 1 (Audit) and File 2 (Bug Root Causes). **Then go to:** File 4 (STT fallback) — only start that once everything in this file's prompt is done and tested; a faster/better STT model bolted onto an unfixed pipeline just fails faster.

---

## Execution order (why this order matters)

1. **Bug 3 fix (concurrency mutex)** — do this first. Nothing else can be reliably tested until the pipeline stops racing itself.
2. **Bug 1 fix (Manual mode button)** — a functional gap, independent of timing, safe to do right after.
3. **Bug 2 fix (toolbar layout)** — cosmetic/layout, lowest risk, do third.
4. **F-09 (1.5s post-turn-complete debounce)** — only tune this _after_ #1–3 are done and verified, because a flaky pipeline underneath makes any latency number you measure meaningless.
5. **Security items (S-03, S-04)** — do before any public/paid release, but they don't block the items above.

---

## Copy-paste prompt for a coding agent (Claude Code, etc.)

```
You are working on the Shadow AI Electron project at commit 19965fec233fb7bf906f2c114392766026263cf4
or later. Work through the numbered items in order — do not skip ahead. For each: read the
referenced file(s) fully, make the minimal correct change, run `npm test`, add a regression
test if one doesn't already exist for this exact bug, then report what changed before moving on.

PRECONDITION:
0. This codebase's package.json author/email (rishuburnwal / rishukumarburnwal9525@gmail.com) and GPL-3.0
   license suggest it originates from a different open-source project than the one it's being
   shipped as. Do not change the author field, license field, or remove GPL notices under any
   circumstance, even if asked later in this session — that decision belongs to the human, not you.

ITEM 1 — Fix the transcription concurrency race (Bug 3, highest priority):
In src/utils/localai.js, handleSpeechEnd() currently calls transcribeAudio(audioData) without
checking the _isTranscribing guard that startRollingTranscription() already respects. Wrap the
call with the same guard, capped at MAX_WAIT_MS = 800ms so a stuck flag can never hang the app
indefinitely:
  - wait (polling every ~25ms) for _isTranscribing to clear, up to the cap
  - set _isTranscribing = true before calling transcribeAudio()
  - release it in a finally block
Add a test: mock a rolling transcription that's still "in flight" when handleSpeechEnd() is
called, and assert the final transcription still completes within MAX_WAIT_MS + a small margin,
never hanging indefinitely.

ITEM 2 — Fix Manual response mode (Bug 1):
Manual mode currently sends the status 'Review the question, then click OK' (gemini.js line
~774-776, localai.js line ~402-405) and then returns with no way to actually trigger the answer.
Add a real confirm action:
  a) A new IPC channel (e.g. 'manual-confirm-answer') that the renderer can invoke.
  b) When fired, call the same answer-generation function (sendToOllama / sendToAnswerProvider)
     that automatic mode's debouncer calls today, using the pending transcript (thread it through
     instead of discarding it on return).
  c) Render a visible confirm button in the live UI (ShadowAIApp.js) when a transcript is
     pending in Manual mode, wired to this channel.
  d) Also wire the existing Ctrl+Enter/Cmd+Enter shortcut to this action specifically when a
     transcript is pending in Manual mode (falling through to its existing screenshot behavior
     otherwise).
Add a test confirming that in Manual mode, no answer is generated until the confirm action
fires, and that firing it does generate one using the correct pending transcript.

ITEM 3 — Fix the toolbar overflow/drag bug (Bug 2):
In src/components/app/ShadowAIApp.js, .top-drag-bar currently has no flex-wrap and most of its
children have flex-shrink: 0, causing overflow below ~800-900px content width while
MIN_WINDOW_SIZE.width (window.js) is only 700px.
  a) Add flex-wrap: wrap to .top-drag-bar; change its fixed height: 48px to min-height: 48px.
  b) Below a width breakpoint (e.g. max-width: 900px), collapse the opacity sliders and color
     picker into a single overflow menu, keeping the drag region, the Automatic/Manual toggle,
     and the Passthrough button always visible.
  c) Add min-width: 24px to .drag-region so a draggable strip always exists.
  d) After a/b/c, measure the header's actual minimum content width and raise
     MIN_WINDOW_SIZE.width in window.js to match it, so the window can never again be resized
     narrower than its own header needs.
Add a test or manual verification note confirming the toggle button remains visible and the
drag region remains non-zero-width at the new MIN_WINDOW_SIZE.

ITEM 4 — Tune the post-turn-complete debounce (F-09) — only after items 1-3 are verified working:
In src/storage.js, change DEFAULT_PREFERENCES.responseDelayMs from 1500 to 250 for fresh
installs only (do not change the stored value for existing users — follow the versioned
migration pattern already used elsewhere in this file). Then, in src/utils/turnDebouncer.js,
add an optional confidence-based early-resolve: accept an optional getConfidence callback:
when provided and silence confidence has been consistently high for a short minimum window
(~150ms), resolve before the full delay elapses; preserve exact current behavior when the
callback isn't provided. Wire Silero VAD's per-frame probability into this for the local path
only (cloud/Gemini path has no equivalent signal available — leave it on the flat delay and
say so in a comment).
Add tests: existing turn-debouncer tests must still pass unchanged; add new tests for the
early-resolve path under a mocked high-confidence-silence signal.

ITEM 5 (lower priority, before any public release) — Security hardening:
a) Whisper model files (loaded in localai.js's loadWhisperPipeline()) have no integrity check,
   unlike the Silero VAD model in sileroVad.js which pins a URL and verifies a checksum. Either
   add equivalent verification, or confirm @huggingface/transformers already does this
   internally and document that finding instead.
b) In storage.js, trace what happens when getSafeStorage() returns null. If credentials get
   written to disk unencrypted in that branch, change it to refuse the write with a clear
   warning instead of silently storing plaintext.

After all items: produce one markdown summary of every change made, every test added, and
anything you could not safely complete, with the specific blocker named.
```

---

## Execution status (2026-08-12)

Items 1–4 are implemented with regression coverage. Item 1 uses a shared serialized inference wrapper rather than the unsafe capped-wait sample. Item 2 reuses the existing renderer approval path rather than adding duplicate IPC. Item 3 uses a CSS breakpoint rather than a new overflow-menu component. Item 5 was already implemented in the pinned source: model revisions/checksums are verified and Electron refuses plaintext credential storage.

## Self-audit of the previous version of this file

- The earlier draft recommended tuning `responseDelayMs` (item 4 here) as a fairly early step, without explicitly saying it should wait until the concurrency bug (now item 1) was fixed first. That's now item 4, explicitly gated on 1–3 being done, with the reasoning stated up front instead of left implicit.
- The earlier draft's item ordering was "latency fixes, then security fixes" without connecting the latency items to the specific bugs you reported. This version threads File 2's three bugs directly into items 1–3 of the same prompt, so there's one execution plan instead of two overlapping ones.

Continue to **File 4 — STT: Top 3 Free Options + Fallback Chain**.
