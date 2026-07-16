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
- Hash-based, fast-forward-only GitHub updater that rebuilds and restarts after validation.

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

On a fresh checkout, choose `2` for complete installation and setup. The workflow checks prerequisites, preserves or creates `.env`, installs dependencies, runs tests, and packages the Electron application. For normal use, choose `1` or simply press Enter to run Shadow AI.

### Numbered launcher menu

| Option | Action                                      |
| -----: | ------------------------------------------- |
|      1 | Run project (default when Enter is pressed) |
|      2 | Complete installation and setup             |
|      3 | Install or update dependencies              |
|      4 | Build application package                   |
|      5 | Update project from GitHub                  |
|      6 | Select API provider and launch              |
|      7 | Show API provider status                    |
|      8 | Show safe system diagnostics                |
|      0 | Exit                                        |

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

- **Provider** selects Auto or a configured provider and shows runtime health.
- **Model** lists the selected provider's live-discovered models and persists the choice.
- **Background** controls overlay/background opacity.
- **AI Text** controls only AI-response text opacity.
- **AI Color** opens a color picker for response text.
- **Passthrough** lets the mouse interact with windows behind the overlay while the recoverable header remains available.

## Local mode

Local mode uses Ollama for responses and `@huggingface/transformers` Whisper models for transcription. Configure the Ollama host/model in the app. The first transcription session may be slower while model assets download.

## Updating safely

Choose launcher option `5`. The updater verifies the expected `RishuBurnwal/Shadow-AI` origin, refuses to overwrite tracked local changes, compares local and remote commit hashes, lists changed files, applies only a fast-forward update, installs dependencies, runs tests, packages the app, and restarts only after validation succeeds. `.env` remains untouched.

## Development and verification

```powershell
npm install
npm test
npm run test:coverage
npm start
npm run package
```

Tests cover provider priority and fallback, safe notifications, status classification, `.env` synchronization contracts, and independent model-list discovery for all six hosted providers.

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
`-- test/                         # Node contract and routing tests
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
