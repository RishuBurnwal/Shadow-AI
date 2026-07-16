# Shadow AI

Shadow AI is an Electron desktop assistant with live screen and audio context, a transparent always-on-top overlay, session history, and automatic multi-provider AI fallback. A numbered Python launcher handles setup, running, packaging, provider selection, diagnostics, and safe GitHub updates.

Use a single `Shadow-AI` checkout as the canonical workspace. The launcher, updater, tests, and documentation are maintained together in this repository; legacy duplicate checkouts are not required.

> Use screen/audio capture and AI assistance only where permitted, and obtain consent before processing other people's audio or content.

## Features

- Groq, OpenRouter, OpenAI, Perplexity, NVIDIA, and Google Gemini providers.
- Live model-list discovery for every configured provider; the header model menu refreshes from the provider API.
- Automatic fallback order: Groq, OpenRouter, OpenAI, Perplexity, NVIDIA, then Gemini.
- Provider status in the header: enabled, active, missing key, authentication error, rate limited, credits exhausted, server error, or network error.
- Missing-key providers remain visible but disabled; provider and model choices persist.
- API keys can be added in the UI and stay synchronized with the local `.env` file.
- Independent header controls for background opacity, AI-response text opacity, AI-response color, and passthrough.
- Named sessions with notes and context, editable history entries, individual deletion, and clear-all history.
- Manual prompts, screen analysis, markdown responses, shortcuts, and optional local Ollama/Whisper mode.
- Configurable complete-question wait (default 1.5 seconds / 1500 ms) that resets on resumed speech before generating an answer.
- Editable prompt skills with six starter presets; enable multiple skills together from **AI & Skills → Skills**.

### Using skills

1. Open **AI & Skills** from the sidebar. The Skills tab opens by default.
2. Enable one or more presets: Instructor & Guide, Professional Answer, Screen Analyst, Interview Answer Coach, Step-by-Step Problem Solver, or Summary & Action Items.
3. Start a session and ask normally. Enabled skills are automatically combined with your selected profile, saved context, and screen/audio input.
4. Use **Edit / rename** to customize a preset, **Delete** to remove it, or **Add skill** to create a new prompt-based skill.

Skills can be combined. For example, enable **Screen Analyst** and **Instructor & Guide** together to inspect the visible screen and explain it step by step.

### Resume and job context

- Open **AI & Skills → Resume** and either upload a text-based PDF (maximum 10 MB) or paste the resume as Markdown/plain text (maximum 50,000 characters).
- Both methods update the same encrypted resume record. PDF and pasted copies are not stored separately.
- Scanned/image-only PDFs require OCR first. Use **Extract profile fields** to update About Me from the saved resume.
- Open **Context** to customize Target Role, Job Description, Company/Industry Context, and Additional Instructions independently.

- Hash-based, fast-forward-only GitHub updater that rebuilds and restarts after validation.

## Current completion status

| Measure                      | Completion | Meaning                                                                                                                             |
| ---------------------------- | ---------: | ----------------------------------------------------------------------------------------------------------------------------------- |
| Original engineering audit   |   **100%** | All 17 identified engineering findings are implemented or verified.                                                               |
| Fixing plan                  |   **100%** | All 12 planned implementation items are complete.                                                                                  |
| Windows feature readiness    |   **100%** | Build, launch, security, local STT, physical microphone, system loopback, tests, packaging, and editable prompt skills pass.        |
| Overall production readiness |    **93%** | Windows is release-tested; authenticated hosted-provider, GPL release governance, and macOS/Linux validation remain external gates. |

The remaining 7% is external validation and release governance, not a known broken Windows module. It cannot honestly be called 100% for every production environment until the hosted accounts, GPL distribution decision, and macOS/Linux release matrix are verified.

### Audit checklist

#### Speech-to-text and latency

- [x] **F-01:** Gemini Live no longer requests unused AUDIO responses.
- [x] **F-02:** One turn-state reducer handles completion, fallback, streaming, reconnect, and barge-in.
- [x] **F-03:** Rolling Whisper inference is bounded to five seconds instead of repeatedly processing an entire growing utterance.
- [x] **F-04:** Final transcription starts without waiting for a rolling pass. Two simultaneous real CPU Whisper calls were verified.
- [x] **F-05:** Settings exposes a persisted 300â€“1200 ms end-of-speech silence control, applied live by the backend.
- [x] **F-06:** Local browser capture requests native 16 kHz audio; 24â†’16 kHz conversion remains a compatibility fallback.
- [x] **F-07:** Cloud and local pipelines emit structured speech-endâ†’transcript and transcriptâ†’first-token latency measurements.
- [x] **F-08:** Each approximately 100 ms audio chunk is forwarded immediately; no client-side batching was found.

#### Security

- [x] **S-01:** Renderer uses `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, and an allow-listed preload bridge.
- [x] **S-02:** AI Markdown is sanitized before DOM insertion and unsafe elements, attributes, and URL schemes are rejected.
- [x] **S-03:** Supported Whisper revisions are immutable and quantized encoder/decoder ONNX weights are SHA-256 verified.
- [x] **S-04:** Credentials use Electron `safeStorage`; production refuses plaintext fallback.
- [x] **S-05:** Electron is updated to 40.10.2, Google GenAI to 2.12.0, and the production dependency audit reports zero vulnerabilities.

#### Reliability and QA

- [x] **A-01:** Reconnect resets turn state, preserves history, and stops retrying after success.
- [x] **A-02:** RMS is explicitly the gate for Silero VAD and silence timing has one persisted user setting.
- [x] **A-03:** Launcher readiness allows 60 seconds for slower first-run startup and passes a live Windows launch smoke.
- [x] **A-04:** Unit, contract, and Electron end-to-end validation passed; line coverage improved from 36.6% to 47.95%.

### Verified release gates

- [x] Unit and contract validation passes.
- [x] Electron end-to-end validation passes.
- [x] Windows Electron Forge packaging passes.
- [x] The Python launcher starts the application successfully.
- [x] `npm audit --omit=dev` reports zero vulnerabilities.
- [x] A real pinned Whisper Tiny CPU model exactly transcribed: `The quick brown fox jumps over the lazy dog.`
- [x] Two overlapping real Whisper inferences returned the same exact transcript.
- [x] The source tree contains no detected committed API key/private-key pattern.
- [x] Physical `Microphone Array` produces live PCM samples through Electron (`peak > 0`).
- [x] Realtek speaker system loopback captures a generated 440 Hz test signal (`peak > 0`).
- [x] Prompt skills support add, edit, rename, enable/disable, and delete; enabled prompts are injected into AI requests.
- [x] Relevant memory facts and system-prompt exports are connected and behavior-tested.

### Remaining checklist and known limitations

- [ ] **GPL/commercial release decision:** keep GPL-3.0 source and attribution available to recipients, or obtain a written relicensing agreement. This is not a code fix.
- [ ] **Hosted-provider live matrix:** run authenticated end-to-end calls against Gemini Live, Groq, OpenRouter, OpenAI, Perplexity, and NVIDIA. Routing and failure behavior are tested without using real secrets, but current live accounts, quotas, and model access were not exercised in the release audit.
- [ ] **Ollama response integration:** start a local Ollama server, pull the configured model, and verify transcriptionâ†’first-tokenâ†’completed-answer on the target machine. Ollama was not running during the audit.
- [x] **Windows physical audio matrix:** microphone and system-loopback streams were opened through Electron and produced live PCM signal.
- [ ] **macOS and Linux release matrix:** Windows is verified; macOS `SystemAudioDump`, Linux audio capture, packaging, signing, and permissions require platform-specific runs.
- [x] **Coverage expansion:** meaningful persistence, prompt, memory, skill, history, limits, and CRUD tests raised line coverage from 36.6% to 47.95%, branch coverage to 70.56%, and function coverage to 61.35%. External-service failure branches remain the next coverage target.
- [ ] **Development dependency audit:** the packaged production dependency tree is clean, but npm still reports issues in development/packaging tools. Monitor Forge and transitive dependency updates.
- [x] **Codebase cleanup:** removed the unused full Lit bundle, stale component barrel/header, legacy onboarding artwork, empty marker file, unused Forge makers, and generated build/test/cache artifacts after reference checks.
- [ ] **Repository-wide formatting debt:** the supplied audit documents plus pre-existing `AICustomizeView.js` and `MainView.js` remain outside a clean whole-repository Prettier pass. Files changed for the audit are formatted.

### Partial, false, or broken implementation classification

| Classification                       | Verified result                                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Partially implemented audit settings | **None found**. VAD timeout, provider/model selection, renderer isolation, credentials, and local sample-rate selection are fully wired through UI, persistence, and backend use. |
| Falsely implemented audit items      | **None found after remediation**. The previously partial Whisper speech-end and integrity checks were completed and retested.                                                     |
| Broken modules in tested scope       | **None found**. Unit, desktop e2e, package, launcher, and real STT gates pass.                                                                                                    |
| Not live-tested modules              | Hosted providers with real credentials, Ollama response generation, physical capture devices, macOS, and Linux. These are explicitly unverified rather than claimed working.      |

## Requirements

| Requirement | Notes                                                 |
| ----------- | ----------------------------------------------------- |
| Python      | 3.10+ recommended                                     |
| Node.js     | 18+                                                   |
| npm         | Included with Node.js                                 |
| Git         | Required for clone and launcher updates               |
| AI access   | At least one hosted API key, or Ollama for local mode |
| Permissions | Screen capture and microphone/system-audio access     |

Windows is the primary verified platform. macOS uses the bundled `SystemAudioDump` helper. Linux capture availability depends on the desktop environment.

## Install and run

```powershell
git clone https://github.com/RishuBurnwal/Shadow-AI.git
cd Shadow-AI
python main.py
```

On a fresh checkout, choose `2` for one-click installation. It verifies Python, Git, Node.js and npm; preserves or creates `.env`; installs the exact `package-lock.json` dependency tree with `npm ci`; verifies installed packages; runs tests; and packages the Electron application. For normal use, choose `1` or press Enter: the launcher first compares the local and official GitHub hashes, safely fast-forwards and validates any update, then starts Shadow AI.

### Numbered launcher menu

| Option | Action                                     |
| -----: | ------------------------------------------ |
|      1 | Run project with automatic verified update |
|      2 | One-click complete installation            |
|      3 | Reinstall exact lockfile dependencies      |
|      4 | Build application package                  |
|      5 | Update project from GitHub                 |
|      6 | Select API provider and launch             |
|      7 | Show API provider status                   |
|      8 | Show safe system diagnostics               |
|      0 | Exit                                       |

No command-line attributes are required for normal use.

## API configuration

The launcher creates `.env` from `.env.example` when needed. Keep only keys in this file; model choices are discovered dynamically and stored as app preferences.

```dotenv
SHADOW_AI_PROVIDER=auto
SHADOW_AI_SILENT=true

GEMINI_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
OPENAI_API_KEY=
PERPLEXITY_API_KEY=
NVIDIA_API_KEY=
```

The real `.env` is ignored by Git and excluded from packaged archives. Adding, replacing, or removing a key in the UI updates `.env`; external `.env` changes are reloaded and reflected in the UI.

Set `SHADOW_AI_SILENT=true` to launch Electron without an npm/Command Prompt window. Set it to `false` when you want a visible terminal for live startup logs. The setting is read from `.env` on every launcher start; values other than `true` or `false` safely fall back to silent mode with a warning.

### Provider and model discovery

| Provider   | Key                  | Model-list request                                                      |
| ---------- | -------------------- | ----------------------------------------------------------------------- |
| Groq       | `GROQ_API_KEY`       | `GET https://api.groq.com/openai/v1/models`                             |
| OpenRouter | `OPENROUTER_API_KEY` | `GET https://openrouter.ai/api/v1/models`                               |
| OpenAI     | `OPENAI_API_KEY`     | `GET https://api.openai.com/v1/models`                                  |
| Perplexity | `PERPLEXITY_API_KEY` | `GET https://api.perplexity.ai/models`                                  |
| NVIDIA     | `NVIDIA_API_KEY`     | `GET https://integrate.api.nvidia.com/v1/models`                        |
| Gemini     | `GEMINI_API_KEY`     | paginated `GET https://generativelanguage.googleapis.com/v1beta/models` |

Model discovery runs for every configured API when provider status is loaded. Opening the model selector forces a fresh request; ordinary refreshes use a five-minute cache. Gemini results are limited to models supporting `generateContent`. If a provider rejects or does not expose model discovery, Shadow AI keeps the last successful catalog or a built-in safe fallback so selection does not break.

API keys are sent only in request headers, never placed in model-list URLs, UI status messages, logs, or fallback notifications.

## Application flow

1. Start the app and enter a session name, optional note, profile, and context.
2. Add at least one API key or select local Ollama mode.
3. Choose `Auto` or a specific enabled provider in the header.
4. Open its model selector to refresh all currently available models, then choose one.
5. Start the session and grant screen/audio permissions.
6. Ask through captured context, manual text, or screen analysis.

The welcome/session setup page appears at startup. Session names, notes, context, responses, and timestamps appear in History, where sessions can be renamed, edited, individually deleted, or cleared together.

### Header controls

| Action                 | Windows default | Behavior                                                                                                                   |
| ---------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Minimize / Restore     | `Ctrl+Shift+M`  | Minimizes a visible window. Pressing it again globally shows, restores, and focuses the same window—even if it was hidden. |
| Maximize / Restore     | `Ctrl+Shift+X`  | Maximizes the window or returns it to its previous size.                                                                   |
| Toggle Visibility      | `Ctrl+\`        | Hides or shows the overlay without ending the active session.                                                              |
| Emergency Erase & Exit | `Ctrl+Shift+E`  | Immediately hides the window, clears local app data, closes the active session, and exits. This is destructive.            |

The yellow and green header buttons use the same minimize/restore and maximize/restore behavior. Window shortcuts are global and can be changed under **Settings → Keyboard Shortcuts**; the current values are also listed on the Help page.

- **Provider** selects Auto or a configured provider and shows runtime health.
- **Model** lists the selected provider's live-discovered models and persists the choice.
- **Background** controls overlay/background opacity.
- **AI Text** controls only AI-response text opacity.
- **AI Color** opens a color picker for response text.
- **Passthrough** lets the mouse interact with windows behind the overlay while the recoverable header remains available.

## Local mode

Local mode uses Ollama for responses and `@huggingface/transformers` Whisper models for transcription. Configure the Ollama host/model in the app. The first transcription session may be slower while model assets download.

## Updating safely

Normal launch (option `1`) checks automatically; option `5` runs it manually. The updater verifies the expected `RishuBurnwal/Shadow-AI` origin, refuses to overwrite tracked local changes, compares local and remote commit hashes, lists changed files, applies only a fast-forward update, verifies the resulting commit and tracked-file hashes, installs the exact lockfile dependencies, validates the app, packages it, and restarts only after validation succeeds. `.env` remains untouched.

## Development and verification

```powershell
npm install
npm start
npm run package
```

## Project structure

```text
Shadow-AI/
|-- main.py                       # Numbered setup/run/build/update launcher
|-- forge.config.js               # Electron Forge packaging and security fuses
|-- src/
|   |-- index.js                  # Main process and IPC
|   |-- storage.js                # Preferences, credentials, and history
|   |-- components/               # Lit UI shell and views
|   `-- utils/
|       |-- gemini.js             # Live session and answer integration
|       |-- providerRouter.js     # Provider fallback and model discovery
|       |-- providerEnv.js        # .env/UI key synchronization
|       |-- localai.js            # Ollama and Whisper mode
|       `-- window.js             # Window, shortcuts, opacity, passthrough
```

## Privacy and security

- Credentials stay local and are redacted from diagnostics and notifications.
- `.env`, build output, caches, logs, and runtime data are excluded from Git.
- Electron security fuses restrict debugging surfaces and validate packaged ASAR integrity.
- Updates accept only the configured repository and fast-forward history.
- Ollama/Whisper mode can keep transcription and response processing local.

## Troubleshooting

**No provider is available:** Run `python main.py`, choose option `7`, then add a key in `.env` or the in-app API manager. Missing-key providers are intentionally greyed out.

**Models do not refresh:** Confirm the provider key is valid and the network is available, then reopen the header model selector. A failed refresh retains the last successful or built-in fallback list.

**App does not start:** Choose launcher option `1` to repair setup or `8` for safe diagnostics. Confirm Node.js and npm are on `PATH`.

**Local mode cannot connect:** Start Ollama, verify its configured host (default `http://127.0.0.1:11434`), and pull the selected model.

**Screen/audio capture fails:** Enable operating-system screen-recording, microphone, and system-audio permissions, then restart the app.

## License

Shadow AI is distributed under the [GNU General Public License v3.0](LICENSE).
