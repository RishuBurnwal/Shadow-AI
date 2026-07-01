# Shadow AI

Shadow AI is a cross-platform Electron desktop assistant that combines live screen context, audio capture, configurable AI providers, and a transparent always-on-top interface.

The project includes a numbered Python launcher for installation, startup, diagnostics, packaging, provider selection, and safe GitHub updates.

> Use Shadow AI only where screen/audio capture and AI assistance are permitted. Obtain consent before recording or processing other people’s audio, meetings, interviews, or presentations.

## Highlights

- Live screen and audio context for AI-assisted responses.
- Automatic provider selection and fallback with safe in-app notifications.
- Groq, OpenRouter, OpenAI, Perplexity, NVIDIA, and Gemini/Gemma support.
- UI-based API key management synchronized with the local `.env` file.
- Optional local mode using Ollama and Whisper.
- Interview, sales, meeting, presentation, negotiation, and exam profiles.
- Transparent always-on-top overlay with independent background opacity, AI-response text opacity, and adjustable response text color.
- Passthrough mode for interacting with applications behind the overlay.
- Conversation history, markdown responses, screen analysis, and manual text prompts.
- Hash-based GitHub updater that validates, rebuilds, and restarts the project.

## Requirements

| Requirement | Notes |
| --- | --- |
| Python | 3.10 or newer recommended |
| Node.js | 18 or newer |
| npm | Installed with Node.js |
| Git | Required for cloning and automatic updates |
| API access | Gemini for hosted live capture; optional answer-provider keys; or Ollama for local mode |
| Permissions | Screen capture and microphone/system-audio access |

Windows is the primary verified development platform. macOS uses the bundled `SystemAudioDump` helper for system audio. Linux support uses available display and microphone capture APIs and may vary by desktop environment.

## Quick Start

```powershell
git clone https://github.com/RishuBurnwal/Shadow-AI.git
cd Shadow-AI
python main.py
```

Choose option `1` for the complete installation and setup workflow. It:

1. Checks Python, Node.js, npm, and required project files.
2. Preserves an existing `.env` or creates one from `.env.example`.
3. Installs npm dependencies.
4. Runs the automated test suite.
5. Builds the Electron application package.

After setup, run `python main.py` again and choose option `3` to start Shadow AI.

## Launcher Menu

Running `python main.py` opens the complete project menu:

| Option | Action |
| ---: | --- |
| 1 | Complete installation and setup |
| 2 | Install or update dependencies |
| 3 | Run project |
| 4 | Build application package |
| 5 | Update project from GitHub |
| 6 | Select API provider and launch |
| 7 | Show API provider status |
| 8 | Show safe system diagnostics |
| 0 | Exit |

## API Providers

Shadow AI discovers configured providers from `.env` and the in-app API manager. In automatic mode, the answer-provider priority is:

1. Groq
2. OpenRouter
3. OpenAI
4. Perplexity
5. NVIDIA
6. Gemma through the Gemini key

If a provider fails, times out, or rejects a request, Shadow AI moves to the next configured provider and displays a temporary notification without exposing the API key.

### Environment configuration

The setup workflow creates `.env` automatically when needed. Keys can also be entered from the application’s `Add API` panel.

```dotenv
SHADOW_AI_PROVIDER=auto

GEMINI_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
OPENAI_API_KEY=
PERPLEXITY_API_KEY=
NVIDIA_API_KEY=
```

Changes made in the UI are written to `.env`. External `.env` changes are reloaded into runtime and reflected by the UI. The real `.env` file is Git-ignored and excluded from packaged application archives.

## Using the Application

1. Configure Gemini for a hosted live session, or select local Ollama mode. Add other providers for answer routing and fallback.
2. Select a session profile and language.
3. Start a session and grant the requested screen/audio permissions.
4. Ask questions through captured context, manual text input, or screen analysis.
5. Use the header controls to adjust the overlay while working.

### Header controls

- **Background** changes the application/background transparency.
- **AI Text** changes only the rendered AI-response text opacity.
- **AI Color** opens a color picker that changes only the rendered AI-response text color.
- **Passthrough** allows mouse interaction with the window behind Shadow AI while keeping the header recoverable.

Background opacity, response opacity, and response color are stored independently and restored on the next launch.

## Local AI Mode

Local mode uses:

- **Ollama** for local text and image-capable model responses.
- **Whisper** through `@huggingface/transformers` for local transcription.

Configure the Ollama host and model from the application. Whisper models are downloaded on first use, so the initial local session can take longer to start.

## Audio Capture

| Platform | Capture path |
| --- | --- |
| Windows | Electron display capture with loopback/system audio and optional microphone |
| macOS | Electron screen capture plus the bundled `SystemAudioDump` helper |
| Linux | Electron display/system capture where available, plus microphone capture |

Audio processing is kept separate from the main UI flow. Local transcription is resampled for Whisper-compatible processing.

## Safe Project Updates

Choose launcher option `5` to update from `RishuBurnwal/Shadow-AI`.

The updater:

1. Verifies that `origin` points to the expected repository.
2. Refuses to overwrite uncommitted tracked changes.
3. Fetches the latest `main` branch and compares local and GitHub commit hashes.
4. Prints the changed-file list when an update exists.
5. Applies only a fast-forward Git update.
6. Installs dependencies, runs tests, and rebuilds the package.
7. Restarts Shadow AI only after validation succeeds.

Local credentials remain untouched because `.env` is not tracked by Git.

## Development

```powershell
npm install
npm test
npm run test:coverage
npm start
```

Build a local Electron package with:

```powershell
npm run package
```

Formatting follows `.prettierrc`:

```powershell
npx prettier --write .
```

## Project Structure

```text
Shadow-AI/
├── main.py                     # Numbered setup, run, build, and update launcher
├── forge.config.js             # Electron Forge packaging and security fuses
├── src/
│   ├── index.js                # Electron main process and IPC registration
│   ├── storage.js              # Preferences, credentials, limits, and history
│   ├── components/             # Lit application shell and views
│   ├── utils/
│   │   ├── gemini.js           # Live session and answer-provider integration
│   │   ├── providerRouter.js   # Provider priority and fallback routing
│   │   ├── providerEnv.js      # Secure `.env` and UI synchronization
│   │   ├── localai.js          # Ollama and Whisper local mode
│   │   └── window.js           # Window, shortcuts, opacity, and passthrough IPC
│   └── assets/                 # Application icons and bundled runtime assets
└── test/                       # Node contract and routing tests
```

## Privacy and Security

- API keys remain local and are never printed by diagnostics or provider notifications.
- `.env`, build output, caches, logs, and local runtime data are excluded from Git.
- The packaged Electron archive does not contain the development `.env` file.
- Electron security fuses disable Node CLI inspection and validate the packaged ASAR.
- Update operations accept only the configured Shadow AI repository and fast-forward history.
- Local Ollama/Whisper mode can keep transcription and response processing on the machine.

## Troubleshooting

### No provider is available

Run `python main.py` and choose option `7`. Hosted live capture requires Gemini; additional answer providers can be configured through `.env` or the in-app `Add API` panel. Local mode requires a running Ollama instance instead.

### The application does not start

Choose option `1` to re-run the complete setup, or option `8` for safe diagnostics. Confirm that Node.js 18+ and npm are available on `PATH`.

### Local mode cannot connect

Start Ollama, confirm the configured host (default `http://127.0.0.1:11434`), and ensure the selected model has been pulled locally.

### Screen or audio capture fails

Check operating-system privacy permissions for screen recording, microphone access, and system audio capture, then restart the application.

## License

Shadow AI is distributed under the [GNU General Public License v3.0](LICENSE).
