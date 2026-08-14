# Shadow AI — Your Reported Bugs, Traced to Code — File 2 of 6

**Read after:** File 1 (Audit Report). **Then go to:** File 3 (Fixing Plan) — the fixes below are written into that file's copy-paste prompt as items 1–3, in the priority order given here.

Three things you personally hit while using the app, each traced to an exact cause in commit `19965fe`, not general advice.

---

## Bug 3 (fix first) — "Atak jaata hai, doosra question sahi se nahi pakadta" (gets stuck / misses the follow-up question)

**Root cause: a safety mechanism exists in the code but isn't applied everywhere it needs to be.**

`localai.js` line 52: `let _isTranscribing = false; // In-flight guard to prevent concurrent transcribeAudio() calls`. This guard is correctly checked around the _rolling_ (interim) transcription calls — but `handleSpeechEnd()`, which runs the **final** transcription the instant you stop talking, calls `transcribeAudio(audioData)` directly, with no guard at all.

Since `whisperPipeline` is one shared model instance, here's the failure sequence: Question A ends → final transcription starts (can take multiple seconds on CPU) → before it finishes, Question B (an interviewer follow-up) ends too → a **second, concurrent** call fires into the _same_ pipeline instance. Two concurrent inference calls on one ONNX/transformers.js session is exactly the scenario `_isTranscribing` was built to prevent — it just isn't wired into this call site. Depending on timing this produces a hang (your "atak jaata hai") or a garbled/wrong transcript for one or both questions (your "doosra audio sahi se nahi pakadta").

**Fix:** wrap the final `transcribeAudio()` call in `handleSpeechEnd()` with the same mutex, but with a capped wait (not an unbounded block) so a stuck flag can never freeze the app forever:

```js
const MAX_WAIT_MS = 800;
const waitStart = Date.now();
while (_isTranscribing && Date.now() - waitStart < MAX_WAIT_MS) {
    await new Promise(r => setTimeout(r, 25));
}
_isTranscribing = true;
try {
    const transcription = await transcribeAudio(audioData);
    // ...existing logic...
} finally {
    _isTranscribing = false;
}
```

---

## Bug 1 (fix second) — "Manual send me button sahi se nahi dikhta" (Manual mode's button doesn't display)

**Root cause: the button doesn't exist — this isn't a rendering bug, it's an unfinished feature.**

When `preferences.automaticResponse` is `false`, both `gemini.js` (line 774) and `localai.js` (line ~402) do exactly this and then stop:

```js
sendToRenderer('update-status', 'Review the question, then click OK');
return;
```

No answer is ever generated after that. I checked every renderer file (`renderer.js`, `ShadowAIApp.js`, `AssistantView.js`, `preload.js`) for a button, IPC channel, or shortcut that could be the "OK" this message refers to — none exists. The only nearby shortcut (`Ctrl+Enter`) triggers a screenshot, not a question confirmation.

**Fix:** add a real confirm action — either a visible on-screen button (bound to a new IPC channel that calls the same answer-generation function the automatic-mode debouncer calls today, using the transcript already held in memory at the point the code currently just `return`s), or repurpose `Ctrl+Enter` for this specific case when a transcript is pending in Manual mode — ideally both, since a keyboard-only affordance is easy to miss.

---

## Bug 2 (fix third) — "Chhota karne pe drag/resize problem" (drag/resize breaks when shrinking the window)

**Root cause: the top toolbar can't shrink or wrap, and its content is wider than the window's own minimum size.**

`ShadowAIApp.js`'s `.top-drag-bar` is a `display: flex` row with **no `flex-wrap`** and **no `overflow-x`**, and nearly every control inside it (opacity sliders, color picker, provider dropdown, mode toggle, passthrough button) has `flex-shrink: 0` — none of them are allowed to shrink. Adding their widths up comes to roughly 800–900px, while `MIN_WINDOW_SIZE.width` (`window.js`) is only 700px — **the window's own resize floor is narrower than its header needs.** Below that overflow point, the only flexible element (`.drag-region`) collapses toward 0 width — which is both your **missing drag handle** (nothing left to grab) and your **missing Automatic/Manual button** (pushed past the visible edge with nowhere to wrap to) — one layout bug causing what looked like two separate symptoms.

**Fix:** add `flex-wrap: wrap` to `.top-drag-bar` (and drop the fixed `height: 48px` in favor of `min-height`), collapse secondary controls (opacity sliders, color picker) into an overflow menu below a width breakpoint, give `.drag-region` a `min-width` floor so it can never hit exactly 0, then raise `MIN_WINDOW_SIZE.width` to match whatever the header actually needs after the fix.

---

## Why this order (3 → 1 → 2)

Bug 3 can silently corrupt or hang the exact data the other two features depend on — fixing Manual mode's button or the toolbar layout on top of a transcription pipeline that occasionally races itself just means your new UI is confirming or displaying a possibly-wrong answer. Fix the data path first, then the UI around it.

## Source-verified correction (2026-08-12)

Bug 3 was fixed by serializing every call at the shared `transcribeAudio` boundary; the earlier capped-wait snippet was unsafe because it could still start concurrent inference after 800 ms. Bug 1's OK button already existed in `AssistantView.js`; the fix reuses it, adds Ctrl/Cmd+Enter, and clears the pending prompt after approval. Bug 2 is fixed by hiding secondary header controls below 900 px and keeping a 24 px drag-region floor. The historical analysis above is retained for context but is superseded by this correction.

## Self-audit of the previous version

- The previous draft presented these three bugs in the order I found them while reading the code, not the order that makes sense to fix them in. This version leads with the priority ordering and explains _why_ (Bug 3 poisons the input the other two act on) instead of leaving that connection implicit.

Continue to **File 3 — Fixing Plan and Prompt**.
