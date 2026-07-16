# Shadow AI — Enhancement Ideas & Future-Proofing Roadmap

Prerequisite: resolve `C-00` (licensing/provenance) and the security items in
`01_AUDIT_REPORT.md` before investing in any of this — building new paid features on
an unresolved legal foundation just increases what you'd have to unwind later.

## 1. Latency & STT — beyond the immediate fix
- **Speculative/partial answer generation**: once the transcript is "probably done" (e.g., VAD silence for 200ms but before the full silence-timeout fires), start a low-cost speculative call to the answer provider with the partial transcript. If the user keeps talking, discard and restart; if they stop, you've saved the full round-trip. This is how several production voice assistants hide latency — genuinely "instant" replies are usually partly an illusion built this way, not just raw pipeline speed.
- **Local-first hybrid mode**: run local VAD + a *tiny* local STT (e.g., `whisper-tiny` or a distilled streaming model) purely to detect "is this a real question or noise," and only invoke the full cloud pipeline (Gemini Live) once that's confirmed — reduces wasted cloud calls and cost, and can shave the first-chunk latency since local VAD reacts faster than a network round trip.
- **Answer-provider warm pooling**: if `sendToAnswerProvider` cold-starts a connection per turn, keep a warm/persistent connection (or connection pool) to the configured provider so turn N+1 doesn't pay connection-setup cost again.

## 2. Reliability & Offline Resilience
- **Graceful cloud→local failover**: if the Gemini Live connection drops mid-session and reconnection fails (`MAX_RECONNECT_ATTEMPTS` exhausted), auto-fall-back to the local Whisper/Ollama pipeline instead of just showing "Session closed," so the user isn't left with a dead app mid-interview/meeting.
- **Pre-warm local models on app start** (background, low-priority) so the first local-mode session doesn't pay the Whisper/Silero download-and-load cost at the exact moment the user needs it — currently this happens lazily on first use per the code (`loadWhisperPipeline`, `initializeSileroVAD`).
- **Session recording/replay for debugging**: optionally persist raw audio + transcript + timing metadata per session (opt-in, clearly disclosed) so latency regressions and STT-accuracy complaints can be diagnosed after the fact instead of only reproduced live.

## 3. Product / Monetization-adjacent features (build only after C-00 is resolved)
- **Server-verified license keys**: since this is already on your radar — design it as a *separate, independently-written service* (per Path C in the audit), not baked into the GPL'd client binary logic. A clean pattern: client holds a short-lived signed token (JWT) fetched from your license server after key validation; app checks token expiry/signature locally and re-validates against the server periodically, with a grace-period offline allowance so paying users aren't locked out by transient network issues.
- **Usage-based tiering**: since you're already routing between multiple answer providers (`providerRouter.js`), a natural paid-tier lever is provider/model selection — free tier on a cheaper/slower model, paid tier unlocking faster models or higher-quality Whisper checkpoints for local mode.
- **Multi-language support hardening**: `speechConfig: { languageCode: language }` and `currentWhisperLanguage` exist already — worth auditing whether language auto-detection vs. fixed-language selection is exposed clearly in onboarding, since STT accuracy complaints are very often actually a language-mismatch issue, not a latency issue.

## 4. Security & Compliance Future-Proofing
- **Automated CI gate on Electron security flags**: add the static test from Fixing Plan item 9 into CI so `nodeIntegration`/`contextIsolation` regressions block merges permanently, not just once.
- **Dependency vulnerability scanning in CI**: add `npm audit --production` (or a tool like `osv-scanner`) as a CI step given the native-module-heavy dependency tree (`onnxruntime-node`, `@huggingface/transformers`) that's easy to let drift.
- **Data handling disclosure**: given this app captures screen + audio + (for some profiles) resume data, a clear in-app privacy notice covering what's sent to which cloud provider (Gemini, Groq/OpenRouter, etc.) vs. what stays local is both good practice and likely a requirement if you sell into regions with data-protection regulation (GDPR-style consent for audio/screen capture is non-trivial).

## 5. Testing & Observability
- **Golden-transcript regression suite**: a small fixed set of recorded test audio clips (various accents, background noise levels, pause patterns) run through both STT paths on every CI run, tracking word-error-rate over time — this turns "did my STT change help or hurt" from a subjective impression into a measured number.
- **Latency dashboards**: once the always-on instrumentation from Fixing Plan item 7 is in place, pipe it to a lightweight local or hosted metrics store (even just structured JSON logs aggregated nightly) so you can see p50/p95 turn-latency trends across releases instead of anecdotal "feels slow" reports.

## 6. Longer-horizon ideas
- **Streaming local STT model evaluation**: once F-03/F-04 (buffer/blocking fixes) land, re-benchmark whisper vs. `faster-whisper`/`whisper.cpp` vs. a genuinely streaming model (SeamlessStreaming, Parakeet-streaming) on your actual target hardware profile (Windows, often CPU-only per the launcher's design) before committing to a swap — the architecture fix may close most of the gap on its own.
- **On-device wake-word / always-listening mode**: if the product direction moves toward "always-on assistant" rather than session-based, a lightweight always-on wake-word detector (e.g., a small keyword-spotting model) ahead of the full VAD+STT pipeline would keep idle CPU/battery cost low while still enabling instant activation.
