# Shadow AI

Shadow AI 0.7.0 is an Electron desktop assistant with voice transcription, text questions, optional screen analysis, and configurable context. It supports hosted API keys and a separate local AI mode.

**Current status:** Windows development checks passed. The latest unsigned packaged executable is blocked on this machine by Windows Application Control; an earlier package passed startup. This is a Windows release candidate, not a claim that every provider, device, or operating system is production verified. See [AUDIT_FIX_REPORT.md](AUDIT_FIX_REPORT.md) for measured results and remaining release checks.

## Start from source

The current build was tested with Node.js 24.12.0 on Windows. Install Node.js and npm, then run:

```powershell
npm ci
npm start
```

The optional Python launcher is available through `python main.py` (Python 3.10+). It supports keyless startup for local mode or first-time API setup, comma/numbered-key counts, exact-lockfile installation, and verified fast-forward updates. `python main.py --info` and `--providers` report diagnostics without revealing keys. Configure provider credentials through the application's API settings or a local `.env` based on [.env.example](.env.example). Never commit real keys.

To build the Windows installer:

```powershell
npm run make -- --platform win32
```

Output: `out/make/squirrel.windows/x64/Shadow AI-0.7.0 Setup.exe`.

## Providers and model selection

Hosted answer providers are Groq, OpenAI, Perplexity, NVIDIA, and Gemini. Availability depends on your credentials, account access, model capabilities, and quota.

In Settings, refresh the provider model catalog, choose a model, and use **Test & add**. This sends a small test request before adding the model to your usable list. Remove models from the same settings panel. The header uses the added model list; it does not show every catalog entry. Audio-only models are excluded from chat selection. Removing all models disables that provider's answer route.

NVIDIA text was verified with `nvidia/nemotron-3.5-lightning-30b-a3b`. Model access can change; use the settings probe when changing models. A successful text probe does not establish image or audio support.

### Multiple API keys

Each provider accepts comma-separated keys, for example:

```dotenv
GROQ_API_KEY=first_key,second_key
```

Whitespace and duplicate keys are normalized. Existing numbered-key configurations remain readable. The dashboard and provider selector show configured key counts, not remaining quota or a guarantee that every key is valid. Eligible authentication and quota failures can rotate to another configured key; provider fallback and timeouts are bounded. Multiple keys cannot guarantee uninterrupted service.

## Choose what context is sent

Settings includes mode-specific context rules and named context profiles. You can select resume/background, JD/role/company, skills, additional instructions, memory, conversation history, audio, screen mode, and whether a recent screen should accompany a voice answer.

| Mode                                         | Default context                                                     | Default screen behavior |
| -------------------------------------------- | ------------------------------------------------------------------- | ----------------------- |
| Interview                                    | Resume, JD, skills, additional instructions, memory, history, audio | Manual                  |
| Quiz / Exam                                  | Skills; resume, JD, memory, history and audio disabled              | Automatic               |
| Sales / Meeting / Presentation / Negotiation | Skills, additional instructions, history, audio                     | Manual                  |

A named context profile saves its rules and skill selection for its mode. Resume and JD content are edited separately; profiles do not create separate copies of those documents. Custom rules override defaults. Old saved preferences may retain earlier selections.

Screen analysis supports **Off**, **Manual**, and **Automatic**. Screen Off is enforced in the backend as well as the UI. Attaching a recent screenshot to voice answers is a separate choice. Audio-off rules prevent that mode's audio content from being used. Select your rules before starting capture; restart the session when changing the transcription provider or Gemini Live configuration.

Resume text can be pasted or imported from a text-based PDF. Scanned PDFs need OCR before import. PDF and pasted resume content update the same saved resume record.

## Voice input and question timing

Transcription and answering are separate stages: a speech provider produces text, then the selected answer route processes it with the allowed context.

| Speech option | Implementation                                          | Live verification on this machine                                 |
| ------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| Auto          | Available hosted speech providers with bounded fallback | Passed through the application                                    |
| Groq          | Whisper transcription                                   | Passed with synthetic speech                                      |
| OpenAI        | `gpt-4o-mini-transcribe`                                | Implemented; no configured key for live verification              |
| Gemini        | Native audio input for transcription                    | Passed with synthetic speech                                      |
| NVIDIA        | Parakeet via NVIDIA gRPC; English                       | Passed with synthetic speech                                      |
| Gemini Live   | Streaming input transcription                           | Previously passed; session configuration requires restart         |
| Local         | Local speech/answer services                            | Live inference not verified; services unavailable on this machine |

Perplexity can answer a transcript produced by another speech provider; it is not offered as a direct speech-transcription route.

In audio settings:

- **Question finished after continuous silence:** choose 300–10,000 ms. Fresh settings default to 1,200 ms. A shorter pause keeps the question open in the batch/local pipeline.
- **Extra wait before answering:** choose 0–10 seconds. Fresh settings default to 750 ms. Resumed speech holds the timer; pending transcription also holds it so a late transcript cannot immediately trigger an answer while more speech is being collected.
- **When to answer:** Automatic waits for the configured timing. Manual accumulates finalized transcription and waits for **OK**.

The wait settings are not an exact end-to-end response deadline: transcription and model latency add time. Capture continues listening until you use **Pause** or end the session. Gemini Live uses provider turn events and the app caps its configured silence boundary at two seconds; restart to apply that configuration. Use Manual when explicit confirmation of a complete question is needed.

## Header and window controls

The header exposes two independent sliders:

- **Screen:** background transparency.
- **AI Text:** answer text opacity.

The header remains opaque and interactive when content opacity is zero. Responsive layouts were checked at 720, 900, 1100, and 1440 pixels. The **More** menu contains additional controls, including model/color options and Windows Focus lock.

Passthrough sends body clicks to the application underneath while preserving header interaction. Use the header drag handle to move the window. Real Windows mouse input was used to verify dragging with passthrough enabled. A fractional-DPI movement fix prevents repeated position updates from progressively enlarging the window. At Windows 125% scaling, 900 updates across three sizes and passthrough states passed; native rounding stays within two DIP instead of accumulating.

**Focus lock** is optional on Windows. It makes the overlay non-focusable so mouse interaction can leave keyboard focus in the previous application. Unlock it to type into Shadow AI. A controlled Windows test verified a click without changing the foreground window; this is not a guarantee that monitoring software cannot detect the application.

Always-on-top, capture protection, passthrough, transparency, and focus handling are different window behaviors. No setting makes the process universally undetectable or guarantees placement above secure desktops and every other application. Capture exclusion also depends on the operating system and capture method.

Common default shortcuts:

| Shortcut        | Action                 |
| --------------- | ---------------------- |
| Ctrl+M          | Toggle passthrough     |
| Ctrl+Shift+P    | Pause/resume capture   |
| Ctrl+Shift+F    | Analyze screen         |
| Ctrl+Arrow      | Move window            |
| Ctrl+[ / Ctrl+] | Previous/next response |

Shortcuts can be customized; another application may already own a global shortcut.

The response font-size setting is restored at startup and normalizes older text-valued preferences. **Restore general settings** applies audio, timing, appearance, focus, and shortcut defaults immediately while retaining documents, named context profiles, and model selections. Speech-provider changes still require a session restart.

## Usage and privacy

Context is bounded to reduce repeated input. Current default budgets include 512 output tokens, bounded recent history, 6,000 resume characters, 8,000 additional-instruction characters, and a 22,000-character system prompt limit. Character limits are not exact token counts. Provider-reported usage is distinguished from estimates.

Automatic screenshot requests skip identical successfully analyzed frames for 30 seconds. Manual capture can resend the same image. A shared busy guard and an 18-second UI watchdog prevent a stuck screen request from leaving the control spinning indefinitely.

Hosted mode sends selected content to the providers used for transcription and answering; fallback may use another configured provider. Local mode requires functioning local services. Privacy mode disables hosted profile-summary extraction and memory processing; it does not turn a hosted answer request into an offline request.

Profile and memory records use Electron safeStorage encryption where available. API keys in `.env` are plaintext: protect that file. Packaging excludes local environment files, logs, test configuration, and development artifacts. Do not assume every local history/configuration file is encrypted.

## Verification and troubleshooting

```powershell
npm test
npm run test:electron
npm run test:drag
npm run test:launcher
npm run lint
npm run build:assets
python -m py_compile main.py
npm audit --omit=dev
node scripts/packaged-smoke.cjs
```

The unit/regression suite covers routing, bounded requests, cancellation, key handling, model selection, context policy, storage failures, and speech timing. The Electron smoke suite uses isolated configuration and synthetic provider responses while exercising actual UI, IPC, native windows, and capture canvas. Packaged smoke requires an existing Windows package and verifies packaged source parity, excluded private files, and executable startup.

Live audit scripts in `scripts/` make real provider requests using synthetic text, images, or speech. They can consume quota. Their logs are local evidence, excluded from distribution. Unit tests and mocked UI requests alone do not establish live provider availability.

If a model fails, check its Settings probe, provider access, and quota. If speech produces no answer, check audio permission/source, the mode's audio rule, transcription provider, Manual/Automatic selection, and local-service availability. With Focus lock enabled, unlock before typing. For screen failures, check screen-sharing permission and Off/Manual/Automatic selection.

### Remaining release checks

- OpenAI and Perplexity live account calls require usable credentials and have not been verified here.
- Local model loading and inference require available local services and suitable hardware.
- Gemini search grounding encountered quota failure; ordinary text, image, and transcription requests succeeded.
- Runtime dependency audit was clean. Development/optional build dependencies still have advisories; review the audit evidence before public release.
- The latest unsigned Windows executable is blocked by this machine's Application Control policy. Build and source parity passed; packaged startup for this rebuild remains blocked. A properly signed distribution and policy-compatible release verification are still needed.
- macOS/Linux packages, signing/notarization, clean-machine install/upgrade/uninstall, and device-specific audio permissions remain unverified.
- Historical generated graph/log references were left intact after automatic approval review blocked their cleanup. They are excluded from distribution; Git history was not rewritten.

## Project layout

| Path                                              | Purpose                                        |
| ------------------------------------------------- | ---------------------------------------------- |
| `src/index.js`, `src/preload.js`                  | Electron startup and allowed IPC bridge        |
| `src/components/`                                 | Lit application, settings, and assistant UI    |
| `src/utils/providerRouter.js`                     | Hosted answer routing and resilience           |
| `src/utils/audioProviders.js`                     | Hosted speech transcription and buffering      |
| `src/utils/contextPolicy.js`                      | Mode/profile content rules                     |
| `src/utils/gemini.js`, `src/utils/localai.js`     | Session orchestration and local integration    |
| `src/utils/window.js`, `src/utils/passthrough.js` | Native window interaction                      |
| `src/storage.js`                                  | Preferences and saved data                     |
| `test/`, `scripts/`                               | Regression, live, UI, and package verification |
| `main.py`                                         | Optional Python launcher                       |

Licensed under [GPL-3.0](LICENSE).
