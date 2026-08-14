# Shadow AI — Enhancements & Roadmap — File 6 of 6 (final)

**Read after:** Files 1–5 are implemented and stable. This is deliberately last — every idea below assumes the concurrency bug, Manual mode, the toolbar layout, the debounce timing, and both fallback chains (STT + API keys) are already fixed. Building new features on top of an unfixed foundation just means debugging two layers of problems at once later.

Prerequisite carried over from File 1: resolve the GPL-3.0 provenance question (§0) before investing heavily in anything monetization-adjacent below.

---

## 1. Latency & turn-taking — beyond File 3's fixes

- **Per-profile response-delay presets.** `responseDelayMs` (File 3, item 4) is already a stored preference — let each interview/meeting "profile" carry its own default, since a rapid technical interview and a slow negotiation call have different pause-vs-full-stop patterns.
- **Speculative answer generation.** Once VAD confidence has read high-silence for a short window, but before the full debounce resolves, start a low-cost speculative call to the answer provider with the partial transcript; discard it if the person keeps talking (the debouncer's existing `interrupt()` already gives you the cancel hook). Hides most of the remaining wait behind work that's already happening.
- **Surface the latency breakdown in the UI**, not just logs — a "last response: transcription Xms, wait Yms, generation Zms" line turns tuning into something self-serve instead of a log dive.

## 2. Reliability, building on Files 4 and 5's fallback chains

- **Cross-chain failover, not just within-chain.** If the _entire_ STT fallback chain (File 4) fails and the _entire_ LLM key rotation (File 5) also has no working provider, the app should degrade to a clear "assistant unavailable" state with a specific reason — not two independent silent failures compounding into one confusing one.
- **Pre-warm the STT fallback chain on app start** (background, low priority) so the first real session doesn't pay the load-and-fallback cost live.
- **Golden-transcript regression suite** — a small fixed set of recorded audio clips (accents, noise, pause patterns) run through all 3 STT engines from File 4 on every CI run, tracking word-error-rate over time so engine swaps are measured, not just felt.

## 3. Product / monetization-adjacent (only after §0's licensing question is resolved)

- **Server-verified license keys as a separate service**, not linked into the GPL client binary (Path (c) from File 1).
- **Usage-based tiering via the provider router** — a free tier on cheaper/slower models, paid tier unlocking Nemotron-quality local STT or faster LLM providers; the router already supports this kind of routing.
- **Optional Deepgram/AssemblyAI tier** (deliberately excluded from File 4's free chain) as a paid add-on for users who bring their own key — their built-in turn detection is a genuinely better match for the "wait fully, reply instantly" goal than any local-only setup can offer.

## 4. Security & compliance, extending File 3 item 5

- **CI gate against Electron security regressions** — a static check that `window.js` never reintroduces `nodeIntegration: true`/`contextIsolation: false`.
- **`npm audit --production` (or `osv-scanner`) in CI**, given the native-module-heavy dependency tree.
- **Data handling disclosure** — a clear in-app notice covering what's sent to which cloud provider vs. what stays local, given the app captures screen + audio + (for some profiles) resume data.

## 5. Testing & observability

- Extend `turn-debouncer.test.js` with the confidence-based early-resolve behavior from File 3 before it ships.
- Pipe the `[SHADOW_LATENCY]` stages (including the new debounce-wait and total-turnaround stages from File 3) to a lightweight metrics store so p50/p95 latency trends are visible across releases.

## 6. Longer-horizon ideas

- **On-device wake-word detection** ahead of the full VAD+STT chain, if the product moves toward "always-on" rather than session-based.
- **Re-benchmark the STT fallback chain periodically** — Nemotron/Moonshine/Whisper are all actively developed; re-run the golden-transcript suite from §2 every few months and re-order the chain in File 4 if a newer checkpoint changes the picture.

---

## Current gate (2026-08-12)

Core reliability, Manual-mode, responsive-header, latency-default, and key-rotation work is complete. STT engine expansion remains intentionally benchmark-gated; roadmap features remain unimplemented until that evidence exists and the GPL decision above is resolved.

## Self-audit of the previous version of this file

- The earlier draft repeated some latency/reliability ideas that had already migrated into what's now File 3's action items — this version keeps only the ideas that are genuinely _future_ work, assuming Files 1–5 are done, and explicitly says so in the opening paragraph instead of leaving the "when should I read this" question implicit.
- The earlier draft's monetization section didn't connect to File 4's decision to exclude paid STT from the free fallback chain — this version explicitly reintroduces Deepgram/AssemblyAI here, as the paid tier File 4 pointed toward, closing that loop instead of leaving it dangling.

**End of the 6-file set.** If you make further changes to the codebase and want this re-audited, share the new commit hash — findings above are pinned to `19965fe` and may drift as the fixes from File 3 land.
