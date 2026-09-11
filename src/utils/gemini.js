const { GoogleGenAI } = require('@google/genai');
let hostedAudioSession = null;
let manualQuestion = '';
function publishFinalQuestion(text) {
    if (!getPreferences().automaticResponse) manualQuestion = [manualQuestion, text].filter(Boolean).join(' ');
    else manualQuestion = '';
    sendToRenderer('interim-transcription', { text: manualQuestion || text, isFinal: true });
}

const { BrowserWindow, ipcMain } = process.versions.electron ? require('electron') : { BrowserWindow: { getAllWindows: () => [] }, ipcMain: null };
const { spawn } = require('child_process');
const { saveDebugAudio } = require('../audioUtils');
const { getSystemPrompt } = require('./prompts');
const {
    getApiKey,
    getGroqApiKey,
    getPreferences,
    incrementCharUsage,
    recordTokenUsage,
    normalizeLanguageCode,
    updatePreference,
} = require('../storage');
const { getConfiguredProviders, streamWithFallback } = require('./providerRouter');
const { readProviderEnv, syncProviderEnvironment } = require('./providerEnv');
const { createTurnDebouncer } = require('./turnDebouncer');
const { routeAudioChunk, labelTranscript } = require('./audioRouting');
const { createRecentScreenshotStore, createOpenAiUserMessage } = require('./multimodal');

// Lazy-loaded to avoid circular dependency (localai.js imports from gemini.js)
let _localai = null;
function getLocalAi() {
    if (!_localai) _localai = require('./localai');
    return _localai;
}

// Provider mode: 'byok' or 'local'
let currentProviderMode = 'byok';
let currentAudioMode = 'speaker_only';
let activeAnswerRequest = null;
let pendingAnswerRequest = null;
const recentScreenshotStore = createRecentScreenshotStore();

function captureRecentScreenshot(data) {
    recentScreenshotStore.capture(data);
}

function getRecentScreenshot() {
    const policy = require('./contextPolicy').resolve(getPreferences());
    return policy.screen === 'off' || !policy.attachScreen ? null : recentScreenshotStore.recent();
}

function setAudioMode(mode) {
    currentAudioMode = ['speaker_only', 'mic_only', 'both'].includes(mode) ? mode : 'speaker_only';
    return currentAudioMode;
}

// Session-scoped state (replaces module-level globals for B3)
let currentSession = null;
const answerDebouncer = createTurnDebouncer();
const TURN_STATE = Object.freeze({ IDLE: 'IDLE', LISTENING: 'LISTENING', AWAITING_ANSWER: 'AWAITING_ANSWER', STREAMING: 'STREAMING' });

function createSessionState() {
    return {
        transcription: '', // currentTranscription
        groqHistory: [], // groqConversationHistory
        turnState: TURN_STATE.IDLE,
        turnStart: 0, // turnStartTime
        lastInputTime: 0, // lastInputTranscriptionTime
    };
}

function transitionTurn(state, event) {
    if (event === 'INPUT') {
        const bargeIn = state.turnState === TURN_STATE.STREAMING;
        if (bargeIn) state.transcription = '';
        state.turnState = TURN_STATE.LISTENING;
        return { bargeIn };
    }
    if ((event === 'TURN_COMPLETE' || event === 'GENERATION_COMPLETE') && state.turnState === TURN_STATE.LISTENING) {
        const transcription = state.transcription.trim();
        state.transcription = '';
        state.turnStart = 0;
        state.lastInputTime = 0;
        state.turnState = transcription ? TURN_STATE.AWAITING_ANSWER : TURN_STATE.IDLE;
        return { transcription };
    }
    if (event === 'ANSWER_STARTED') state.turnState = TURN_STATE.STREAMING;
    if (event === 'ANSWER_FINISHED') state.turnState = TURN_STATE.IDLE;
    return {};
}

function logLatency(path, stage, milliseconds) {
    console.log('[SHADOW_LATENCY]', JSON.stringify({ path, stage, milliseconds }));
}

// Conversation tracking variables
let currentSessionId = null;
let conversationHistory = [];
let screenAnalysisHistory = [];
let currentProfile = null;
let currentCustomPrompt = null;
let isInitializingSession = false;
let currentSystemPrompt = null;

// Debug / timing flag (set SHADOW_AI_DEBUG=1 in environment or .env)
const isDebug = process.env.SHADOW_AI_DEBUG === '1';

// Barge-in support: external AbortController for the currently-streaming answer.
// When new speech is detected mid-answer, this is aborted to cancel the stream.
let _currentAnswerAbort = null;

function cancelCurrentAnswer() {
    if (currentProviderMode === 'local') getLocalAi().cancelLocalAnswer();
    if (_currentAnswerAbort) {
        if (isDebug) console.log('[Barge-in] Cancelling current answer stream');
        _currentAnswerAbort.abort();
        _currentAnswerAbort = null;
    }
    // Clear any partial response from the renderer
    sendToRenderer('clear-current-response');
}

// Gemini Live model configuration (Step C1)
// Models to try in order when connecting a Live session.
// If GEMINI_LIVE_MODEL is set in env, only that model is attempted.
// Otherwise all candidates are tried in order until one connects.
const GEMINI_LIVE_MODEL_CANDIDATES = ['gemini-2.5-flash-native-audio-preview-09-2025', 'gemini-2.5-flash-live'];

function getGeminiLiveModelCandidates() {
    const envModel = process.env.GEMINI_LIVE_MODEL;
    if (envModel) {
        return [envModel]; // If user explicitly set one, only try that
    }
    return [...GEMINI_LIVE_MODEL_CANDIDATES]; // Otherwise try fallbacks in order
}

function formatSpeakerResults(results) {
    let text = '';
    for (const result of results) {
        if (result.transcript && result.speakerId) {
            const speakerLabel = result.speakerId === 1 ? 'Interviewer' : 'Candidate';
            text += `[${speakerLabel}]: ${result.transcript}\n`;
        }
    }
    return text;
}

module.exports.formatSpeakerResults = formatSpeakerResults;

// Audio capture variables
let systemAudioProc = null;

// Reconnection variables
let isUserClosing = false;
let sessionParams = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY = 2000;

function sendToRenderer(channel, data) {
    if (!BrowserWindow?.getAllWindows) return;
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].webContents.send(channel, data);
    }
}

// Build context message for session restoration
function buildContextMessage() {
    const lastTurns = conversationHistory.slice(-20);
    const validTurns = lastTurns.filter(turn => turn.transcription?.trim() && turn.ai_response?.trim());

    if (validTurns.length === 0) return null;

    const contextLines = validTurns.map(turn => `[Interviewer]: ${turn.transcription.trim()}\n[Your answer]: ${turn.ai_response.trim()}`);

    return `Session reconnected. Here's the conversation so far:\n\n${contextLines.join('\n\n')}\n\nContinue from here.`;
}

// Conversation management functions
function initializeNewSession(profile = null, customPrompt = null) {
    manualQuestion = '';
    const preferences = getPreferences();
    currentSessionId = Date.now().toString();
    currentSession = createSessionState();
    conversationHistory = [];
    screenAnalysisHistory = [];
    recentScreenshotStore.clear();
    currentProfile = profile;
    currentCustomPrompt = customPrompt;
    console.log('New conversation session started:', currentSessionId, 'profile:', profile);

    // Save initial metadata for every session, including manually-created ones.
    sendToRenderer('save-session-context', {
        sessionId: currentSessionId,
        profile: profile,
        customPrompt: customPrompt || '',
        sessionName: preferences.sessionName || '',
        sessionNote: preferences.sessionNote || '',
    });
}

function saveConversationTurn(transcription, aiResponse) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const conversationTurn = {
        timestamp: Date.now(),
        transcription: transcription.trim(),
        ai_response: aiResponse.trim(),
    };

    conversationHistory.push(conversationTurn);
    if (isDebug) console.log('Saved conversation turn');

    // Send to renderer to save in IndexedDB
    sendToRenderer('save-conversation-turn', {
        sessionId: currentSessionId,
        turn: conversationTurn,
        fullHistory: conversationHistory,
    });
}

function saveScreenAnalysis(prompt, response, model) {
    if (!currentSessionId) {
        initializeNewSession();
    }

    const analysisEntry = {
        timestamp: Date.now(),
        prompt: prompt,
        response: response.trim(),
        model: model,
    };

    screenAnalysisHistory.push(analysisEntry);
    if (isDebug) console.log('Saved screen analysis');

    // Send to renderer to save
    sendToRenderer('save-screen-analysis', {
        sessionId: currentSessionId,
        analysis: analysisEntry,
        fullHistory: screenAnalysisHistory,
        profile: currentProfile,
        customPrompt: currentCustomPrompt,
    });
}

function getCurrentSessionData() {
    return {
        sessionId: currentSessionId,
        history: conversationHistory,
    };
}

async function getEnabledTools() {
    return getPreferences().googleSearchEnabled ? [{ googleSearch: {} }] : [];
}

async function getStoredSetting(key, defaultValue) {
    const value = getPreferences()[key];
    return value == null ? defaultValue : String(value);
}

const MAX_CONTEXT_MESSAGES = 2;

function getRecentConversationHistory(history, maxMessages = MAX_CONTEXT_MESSAGES) {
    return Array.isArray(history)
        ? history.slice(-maxMessages).map(message => ({ ...message, content: String(message.content || '').slice(0, 4000) }))
        : [];
}

function trimConversationHistoryForGemini(history, maxChars = 42000, maxMessages = MAX_CONTEXT_MESSAGES) {
    if (!history || history.length === 0) return [];
    let totalChars = 0;
    const trimmed = [];

    for (let i = history.length - 1; i >= 0 && trimmed.length < maxMessages; i--) {
        const turn = history[i];
        const turnChars = (turn.content || '').length;

        if (totalChars + turnChars > maxChars) break;
        totalChars += turnChars;
        trimmed.unshift(turn);
    }
    return trimmed;
}

function stripThinkingTags(text) {
    return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim();
}

const { extractFactsFromSession, getMemory, mergeFacts, saveMemory } = require('../memory');

async function generateSessionSummary(history) {
    if (!history || history.length < 2) return '';

    const turns = history
        .slice(-6)
        .map(t => `User: ${(t.transcription || '').trim().slice(0, 1500)}\nAssistant: ${(t.ai_response || '').trim().slice(0, 1500)}`)
        .join('\n\n');
    if (!turns.trim()) return '';

    const summaryPrompt = `Summarize the following conversation in 1-2 sentences:\n\n${turns}\n\nSummary:`;

    try {
        const credentials = syncProviderEnvironment();
        const env = {
            ...process.env,
            GROQ_API_KEY: getGroqApiKey() || process.env.GROQ_API_KEY,
            GEMINI_API_KEY: getApiKey() || process.env.GEMINI_API_KEY,
            OPENAI_API_KEY: credentials.openaiApiKey || process.env.OPENAI_API_KEY,
            PERPLEXITY_API_KEY: credentials.perplexityApiKey || process.env.PERPLEXITY_API_KEY,
            NVIDIA_API_KEY: credentials.nvidiaApiKey || process.env.NVIDIA_API_KEY,
        };
        const providers = getConfiguredProviders(env, require('../storage').getPreferences());
        const openaiProviders = providers;
        if (openaiProviders.length === 0) return '';

        const result = await streamWithFallback({
            providers: openaiProviders,
            messages: [{ role: 'user', content: summaryPrompt }],
            onToken: () => {},
        });
        return result.text.trim();
    } catch {
        return '';
    }
}

function sendToAnswerProvider(transcription, options = {}) {
    if (activeAnswerRequest) {
        pendingAnswerRequest = { transcription, options };
        return activeAnswerRequest;
    }
    activeAnswerRequest = (async () => {
        let next = { transcription, options };
        let result;
        do {
            pendingAnswerRequest = null;
            result = await sendToAnswerProviderNow(next.transcription, next.options);
            next = pendingAnswerRequest;
        } while (next);
        return result;
    })().finally(() => {
        activeAnswerRequest = null;
        pendingAnswerRequest = null;
    });
    return activeAnswerRequest;
}

function getNewUsageChars(input, output) {
    return String(input || '').trim().length + String(output || '').trim().length;
}

async function sendToAnswerProviderNow(transcription, options = {}) {
    if (!transcription || !transcription.trim()) return;
    if (!currentSession) initializeNewSession();
    const prefs = getPreferences();
    const policy = require('./contextPolicy').resolve(prefs);
    currentSystemPrompt = getSystemPrompt(prefs.selectedProfile, '', Boolean(prefs.googleSearchEnabled));
    const signature = JSON.stringify(policy);
    if (currentSession.contextSignature !== signature) currentSession.groqHistory = [];
    currentSession.contextSignature = signature;
    const screenshot = policy.screen === 'off' ? null : options.screenshot === undefined ? getRecentScreenshot() : options.screenshot;

    const credentials = syncProviderEnvironment();
    const env = {
        ...process.env,
        GROQ_API_KEY: getGroqApiKey() || process.env.GROQ_API_KEY,
        GEMINI_API_KEY: getApiKey() || process.env.GEMINI_API_KEY,
        OPENAI_API_KEY: credentials.openaiApiKey || process.env.OPENAI_API_KEY,
        PERPLEXITY_API_KEY: credentials.perplexityApiKey || process.env.PERPLEXITY_API_KEY,
        NVIDIA_API_KEY: credentials.nvidiaApiKey || process.env.NVIDIA_API_KEY,
    };
    const providers = getConfiguredProviders(env, require('../storage').getPreferences());
    const genericProviders = providers;

    const history = currentSession ? currentSession.groqHistory : [];
    if (currentSession) currentSession.groqHistory = history.slice(-20);
    let isFirst = true;
    let fallbackOccurred = false;
    const providerLabel = provider => ({ groq: 'Groq', openai: 'OpenAI', perplexity: 'Perplexity', nvidia: 'NVIDIA' })[provider] || provider;

    try {
        // Create a fresh abort controller for this answer stream (enables barge-in)
        _currentAnswerAbort = new AbortController();

        const result = await streamWithFallback({
            providers: genericProviders,
            googleSearch: Boolean(getPreferences().googleSearchEnabled),
            requestType: screenshot ? 'vision' : 'text',
            totalTimeoutMs: screenshot ? 18000 : 60000,
            timeoutMs: screenshot ? 7000 : 30000,
            messages: [
                { role: 'system', content: currentSystemPrompt || 'You are a helpful assistant.' },
                ...(policy.history ? getRecentConversationHistory(currentSession ? currentSession.groqHistory : []) : []),
                createOpenAiUserMessage(transcription.trim(), screenshot),
            ],
            onToken: (token, fullText) => {
                const displayText = stripThinkingTags(fullText);
                if (!displayText) return;
                if (isFirst && currentSession?.answerRequestedAt) {
                    logLatency('byok', 'transcription_ready_to_answer_first_token', Date.now() - currentSession.answerRequestedAt);
                    currentSession.answerRequestedAt = 0;
                }
                sendToRenderer(isFirst ? 'new-response' : 'update-response', displayText);
                isFirst = false;
            },
            onProviderFailure: ({ provider, nextProvider, reason }) => {
                fallbackOccurred = true;
                const message = nextProvider
                    ? `${providerLabel(provider)} unavailable (${reason}). Switching to ${providerLabel(nextProvider)}.`
                    : `${providerLabel(provider)} unavailable (${reason}).`;
                sendToRenderer('provider-notification', { type: 'warning', message });
            },
            onProviderSelected: ({ provider }) => {
                sendToRenderer('provider-notification', {
                    type: 'success',
                    message: fallbackOccurred ? `Fallback active: using ${providerLabel(provider)}.` : `Using ${providerLabel(provider)}.`,
                });
            },
            signal: _currentAnswerAbort.signal,
        });

        // Clean up abort controller now that streaming is done
        if (_currentAnswerAbort && !_currentAnswerAbort.signal.aborted) {
            _currentAnswerAbort = null;
        }

        recordTokenUsage(result.provider, result.model, result.usage);
        const cleanedResponse = stripThinkingTags(result.text);
        incrementCharUsage(result.provider, result.model.split('/').pop(), getNewUsageChars(transcription, cleanedResponse));
        if (!cleanedResponse) throw new Error('Provider returned reasoning without an answer. Choose a non-reasoning model or try again.');
        if (currentSession)
            currentSession.groqHistory.push({ role: 'user', content: transcription.trim() }, { role: 'assistant', content: cleanedResponse });
        saveConversationTurn(transcription, cleanedResponse);
        console.log(`Answer completed via ${result.provider} (${result.model})`);
        sendToRenderer('update-status', result.partial ? `Answer interrupted: ${result.warning}` : 'Listening...');
        return { ...result, text: cleanedResponse };
    } catch (error) {
        // If the stream was cancelled due to barge-in, don't show error notifications
        if (error.name === 'AbortError' || error.message?.includes('abor')) {
            if (isDebug) console.log('[Barge-in] Answer stream cancelled, new turn starting');
            return null;
        }
        console.warn('Hosted answer providers failed:', error.failures || error.message);
        sendToRenderer('update-status', error.message);
        return { error: error.message };
    } finally {
        _currentAnswerAbort = null;
    }
}

async function initializeGeminiSession(apiKey, customPrompt = '', profile = 'interview', language = 'en-US', isReconnect = false) {
    const allKeys = require('./apiKeys').splitApiKeys(apiKey || process.env.GEMINI_API_KEY);
    apiKey = allKeys.join(',');
    language = normalizeLanguageCode(language);
    if (isInitializingSession) {
        console.log('Session initialization already in progress');
        return false;
    }

    isInitializingSession = true;
    if (!isReconnect) {
        sendToRenderer('session-initializing', true);
    }

    // Store params for reconnection
    if (!isReconnect) {
        sessionParams = { apiKey, customPrompt, profile, language };
        reconnectAttempts = 0;
    }

    // Get enabled tools first to determine Google Search status
    const enabledTools = await getEnabledTools();
    const googleSearchEnabled = enabledTools.some(tool => tool.googleSearch);

    // Load enabled skills from preferences for skill prompt fragments
    const prefs = getPreferences();
    const enabledSkills = Array.isArray(prefs.enabledSkills) ? prefs.enabledSkills : null;
    const systemPrompt = getSystemPrompt(profile, customPrompt, googleSearchEnabled, enabledSkills);
    currentSystemPrompt = systemPrompt; // Store for Groq

    // Initialize new conversation session only on first connect
    if (!isReconnect) {
        initializeNewSession(profile, customPrompt);
    } else {
        // On reconnect, create fresh session state but keep history
        const oldHistory = currentSession ? currentSession.groqHistory : [];
        currentSession = createSessionState();
        currentSession.groqHistory = oldHistory;
    }

    // Try model candidates in order until one connects
    const modelCandidates = getGeminiLiveModelCandidates();
    let session = null;
    let lastError = null;

    const attempts = allKeys.flatMap((_, offset) =>
        modelCandidates.map(model => ({ model, key: allKeys[(reconnectAttempts + offset) % allKeys.length] }))
    );
    for (const { model, key } of attempts) {
        try {
            const client = new GoogleGenAI({ vertexai: false, apiKey: key, httpOptions: { apiVersion: 'v1alpha' } });
            session = await client.live.connect({
                model: model,
                callbacks: {
                    onopen: function () {
                        sendToRenderer('update-status', 'Live session connected');
                    },
                    onmessage: function (message) {
                        if (!require('./contextPolicy').resolve(getPreferences()).audio) return;
                        if (isDebug) {
                            console.log('----------------', message);
                        }

                        // Handle input transcription (what was spoken)
                        if (!currentSession) currentSession = createSessionState();
                        const s = currentSession;

                        const inputTranscription = message.serverContent?.inputTranscription;
                        const inputText = inputTranscription?.results
                            ? formatSpeakerResults(inputTranscription.results)
                            : inputTranscription?.text || '';
                        const hasInputSpeech = inputText.trim().length > 0;

                        if (hasInputSpeech && transitionTurn(s, 'INPUT').bargeIn) {
                            if (isDebug) console.log('[Barge-in] User started speaking mid-answer, cancelling stream');
                            cancelCurrentAnswer();
                            sendToRenderer('update-status', 'Listening... (interrupted)');
                        }
                        if (hasInputSpeech) answerDebouncer.hold(true);

                        if (hasInputSpeech) {
                            s.transcription += inputText;
                            sendToRenderer('interim-transcription', { text: s.transcription, isFinal: false });
                        }

                        // Track timing: whenever input transcription updates, note the time
                        if (hasInputSpeech) {
                            s.lastInputTime = Date.now();
                            if (s.turnStart === 0) {
                                s.turnStart = Date.now();
                            }
                        }

                        const endEvent = message.serverContent?.turnComplete
                            ? 'TURN_COMPLETE'
                            : message.serverContent?.generationComplete
                              ? 'GENERATION_COMPLETE'
                              : null;
                        if (endEvent) {
                            answerDebouncer.hold(false);
                            const speechEndedAt = Date.now();
                            const finalText = s.transcription;
                            const { transcription } = transitionTurn(s, endEvent);
                            if (transcription) {
                                logLatency('byok', 'speech_end_to_transcription_ready', Date.now() - speechEndedAt);
                                publishFinalQuestion(finalText);
                                const preferences = getPreferences();
                                if (!preferences.automaticResponse) {
                                    sendToRenderer('update-status', 'Review the question, then click OK');
                                    return;
                                }
                                answerDebouncer.setDelay(preferences.responseDelayMs);
                                sendToRenderer('update-status', 'Waiting for complete question...');
                                answerDebouncer.schedule(transcription, completeTranscription => {
                                    if (!getPreferences().automaticResponse) return;
                                    s.answerRequestedAt = Date.now();
                                    transitionTurn(s, 'ANSWER_STARTED');
                                    return Promise.resolve(sendToAnswerProvider(completeTranscription)).finally(() =>
                                        transitionTurn(s, 'ANSWER_FINISHED')
                                    );
                                });
                            } else {
                                sendToRenderer('update-status', 'Listening...');
                            }
                        }
                    },
                    onerror: function (e) {
                        console.log('Session error:', e.message);
                        sendToRenderer('update-status', 'Error: ' + e.message);
                    },
                    onclose: function (e) {
                        console.log('Session closed:', e.reason);

                        // Don't reconnect if user intentionally closed
                        if (isUserClosing) {
                            isUserClosing = false;
                            sendToRenderer('update-status', 'Session closed');
                            return;
                        }

                        // Attempt reconnection
                        if (sessionParams && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                            attemptReconnect();
                        } else {
                            sendToRenderer('update-status', 'Session closed');
                        }
                    },
                },
                config: {
                    // Native-audio models require AUDIO; only the input transcription is used.
                    responseModalities: ['AUDIO'],
                    inputAudioTranscription: {},
                    realtimeInputConfig: {
                        automaticActivityDetection: {
                            silenceDurationMs: Math.min(2000, require('./turnDebouncer').normalizeSilenceMs(prefs.vadSilenceMs)),
                        },
                    },
                    contextWindowCompression: { slidingWindow: {} },
                    speechConfig: { languageCode: language },
                    systemInstruction: {
                        parts: [{ text: 'Transcribe the incoming speech accurately. Do not answer questions or provide commentary.' }],
                    },
                },
            });
            console.log(`Live session connected with model: ${model}`);
            break;
        } catch (error) {
            lastError = error;
            console.warn(`Failed to connect with Live model "${model}": ${error.message}`);
            // Try next model candidate
        }
    }

    if (session) {
        isInitializingSession = false;
        if (!isReconnect) {
            sendToRenderer('session-initializing', false);
        }
        return session;
    }

    // All model candidates failed
    console.error('Failed to initialize Gemini session:', lastError?.message || 'Unknown error');
    isInitializingSession = false;
    if (!isReconnect) {
        sendToRenderer('session-initializing', false);
    }
    // Notify user about the model connection failure
    const attemptedModel = process.env.GEMINI_LIVE_MODEL || GEMINI_LIVE_MODEL_CANDIDATES[0];
    sendToRenderer('provider-notification', {
        type: 'warning',
        message: `Live session failed with model "${attemptedModel}". Verify your API key has access to a compatible Live model, or set GEMINI_LIVE_MODEL in .env.`,
    });
    return null;
}

async function attemptReconnect() {
    reconnectAttempts++;
    console.log(`Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

    sendToRenderer('update-status', `Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    // Wait before attempting
    await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY));

    if (isUserClosing || !sessionParams) return false;
    try {
        const session = await initializeGeminiSession(
            sessionParams.apiKey,
            sessionParams.customPrompt,
            sessionParams.profile,
            sessionParams.language,
            true // isReconnect
        );
        if (session && global.geminiSessionRef) {
            global.geminiSessionRef.current = session;

            // Transcription services receive audio only, never candidate context or prior answers.

            return true;
        }
    } catch (error) {
        console.error(`Reconnection attempt ${reconnectAttempts} failed:`, error);
    }

    // If we still have attempts left, try again
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        return attemptReconnect();
    }

    // Max attempts reached - notify frontend
    console.log('Max reconnection attempts reached');
    sendToRenderer('reconnect-failed', {
        message: 'Tried 3 times to reconnect. Must be upstream/network issues. Try restarting or download updated app from site.',
    });
    sessionParams = null;
    return false;
}

function killExistingSystemAudioDump() {
    return new Promise(resolve => {
        console.log('Checking for existing SystemAudioDump processes...');

        // Kill any existing SystemAudioDump processes
        const killProc = spawn('pkill', ['-f', 'SystemAudioDump'], {
            stdio: 'ignore',
        });

        killProc.on('close', code => {
            if (code === 0) {
                console.log('Killed existing SystemAudioDump processes');
            } else {
                console.log('No existing SystemAudioDump processes found');
            }
            resolve();
        });

        killProc.on('error', err => {
            console.log('Error checking for existing processes (this is normal):', err.message);
            resolve();
        });

        // Timeout after 2 seconds
        setTimeout(() => {
            killProc.kill();
            resolve();
        }, 2000);
    });
}

async function startMacOSAudioCapture(geminiSessionRef) {
    if (process.platform !== 'darwin') return false;

    // Kill any existing SystemAudioDump processes first
    await killExistingSystemAudioDump();

    console.log('Starting macOS audio capture with SystemAudioDump...');

    const { app } = require('electron');
    const path = require('path');

    let systemAudioPath;
    if (app.isPackaged) {
        systemAudioPath = path.join(process.resourcesPath, 'SystemAudioDump');
    } else {
        systemAudioPath = path.join(__dirname, '../assets', 'SystemAudioDump');
    }

    console.log('SystemAudioDump path:', systemAudioPath);

    const spawnOptions = {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
        },
    };

    systemAudioProc = spawn(systemAudioPath, [], spawnOptions);

    if (!systemAudioProc.pid) {
        console.error('Failed to start SystemAudioDump');
        return false;
    }

    console.log('SystemAudioDump started with PID:', systemAudioProc.pid);

    const CHUNK_DURATION = 0.1;
    const SAMPLE_RATE = 24000;
    const BYTES_PER_SAMPLE = 2;
    const CHANNELS = 2;
    const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * CHUNK_DURATION;

    let audioBuffer = Buffer.alloc(0);

    systemAudioProc.stdout.on('data', data => {
        audioBuffer = Buffer.concat([audioBuffer, data]);

        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);
            if (!require('./contextPolicy').resolve(getPreferences()).audio) continue;

            const monoChunk = CHANNELS === 2 ? convertStereoToMono(chunk) : chunk;

            if (currentProviderMode === 'local') {
                getLocalAi().processLocalAudio(monoChunk, 'audio/pcm;rate=24000', 'speaker', currentAudioMode);
            } else {
                const base64Data = monoChunk.toString('base64');
                sendAudioToGemini(base64Data, geminiSessionRef);
            }

            if (process.env.DEBUG_AUDIO) {
                console.log(`Processed audio chunk: ${chunk.length} bytes`);
                saveDebugAudio(monoChunk, 'system_audio');
            }
        }

        const maxBufferSize = SAMPLE_RATE * BYTES_PER_SAMPLE * 1;
        if (audioBuffer.length > maxBufferSize) {
            audioBuffer = audioBuffer.slice(-maxBufferSize);
        }
    });

    systemAudioProc.stderr.on('data', data => {
        console.error('SystemAudioDump stderr:', data.toString());
    });

    systemAudioProc.on('close', code => {
        console.log('SystemAudioDump process closed with code:', code);
        systemAudioProc = null;
    });

    systemAudioProc.on('error', err => {
        console.error('SystemAudioDump process error:', err);
        systemAudioProc = null;
    });

    return true;
}

function convertStereoToMono(stereoBuffer) {
    const samples = stereoBuffer.length / 4;
    const monoBuffer = Buffer.alloc(samples * 2);

    for (let i = 0; i < samples; i++) {
        const leftSample = stereoBuffer.readInt16LE(i * 4);
        monoBuffer.writeInt16LE(leftSample, i * 2);
    }

    return monoBuffer;
}

function stopMacOSAudioCapture() {
    if (systemAudioProc) {
        console.log('Stopping SystemAudioDump...');
        systemAudioProc.kill('SIGTERM');
        systemAudioProc = null;
    }
}

async function sendAudioToGemini(base64Data, geminiSessionRef) {
    if (!require('./contextPolicy').resolve(getPreferences()).audio) return;
    if (hostedAudioSession) {
        hostedAudioSession.push(Buffer.from(base64Data, 'base64'), 'speaker', 24000);
        return;
    }
    if (!geminiSessionRef.current) return;

    try {
        if (isDebug) process.stdout.write('.');
        await geminiSessionRef.current.sendRealtimeInput({
            audio: {
                data: base64Data,
                mimeType: 'audio/pcm;rate=24000',
            },
        });
    } catch (error) {
        console.error('Error sending audio to Gemini:', error);
    }
}

async function sendImageToGeminiHttp(base64Data, prompt) {
    const result = await sendToAnswerProvider(prompt || 'Analyze this screen concisely.', { screenshot: base64Data });
    if (!result?.text) return { success: false, error: result?.error || 'Screen analysis cancelled' };
    saveScreenAnalysis(prompt || '', result.text, result.model);
    return { success: true, ...result };
}

function setupGeminiIpcHandlers(geminiSessionRef) {
    ipcMain.handle('cancel-answer', () => {
        pendingAnswerRequest = null;
        cancelCurrentAnswer();
        return { success: true };
    });
    setAudioMode(getPreferences().audioMode);
    // Store the geminiSessionRef globally for reconnection access
    global.geminiSessionRef = geminiSessionRef;

    ipcMain.handle('initialize-gemini', async (event, apiKey, customPrompt, profile = 'interview', language = 'en-US') => {
        currentProviderMode = 'byok';
        hostedAudioSession?.close();
        hostedAudioSession = null;
        const prefs = getPreferences();
        const policy = require('./contextPolicy').resolve(prefs, profile);
        if (!policy.audio || prefs.audioMode === 'screen_only') {
            currentSystemPrompt = getSystemPrompt(profile, '', false);
            initializeNewSession(profile, '');
            sendToRenderer('update-status', 'Text and screen ready · audio disabled by profile');
            return true;
        }
        if ((prefs.transcriptionProvider || 'auto') !== 'gemini-live') {
            syncProviderEnvironment();
            const { createAudioSession, SUPPORTED_AUDIO } = require('./audioProviders');
            const candidates = getConfiguredProviders().filter(
                p =>
                    SUPPORTED_AUDIO.includes(p.id) &&
                    (!prefs.transcriptionProvider || prefs.transcriptionProvider === 'auto' || p.id === prefs.transcriptionProvider)
            );
            currentSystemPrompt = getSystemPrompt(profile, '', false);
            initializeNewSession(profile, '');
            if (!candidates.length) {
                sendToRenderer('update-status', 'Text and screen ready. Add a supported transcription API key for voice.');
                return true;
            }
            hostedAudioSession = createAudioSession({
                getSilenceMs: () => getPreferences().vadSilenceMs,
                onListeningChange: listening => answerDebouncer.hold(listening),
                options: { provider: prefs.transcriptionProvider || 'auto', language },
                onSpeech: () => {
                    answerDebouncer.interrupt();
                    cancelCurrentAnswer();
                },
                onError: error => sendToRenderer('update-status', `Voice: ${error.message}`),
                onTranscript: (text, source, provider) => {
                    if (!require('./contextPolicy').resolve(getPreferences()).audio) return;
                    const transcript = labelTranscript(source, text);
                    publishFinalQuestion(transcript);
                    sendToRenderer('update-status', `Transcribed via ${provider}`);
                    if (!getPreferences().automaticResponse) return;
                    answerDebouncer.setDelay(getPreferences().responseDelayMs);
                    answerDebouncer.schedule(transcript, complete => {
                        if (getPreferences().automaticResponse && require('./contextPolicy').resolve(getPreferences()).audio)
                            return sendToAnswerProvider(complete);
                    });
                },
            });
            sendToRenderer('update-status', `Voice ready · ${prefs.transcriptionProvider || 'auto'}`);
            return true;
        }
        if (!apiKey) {
            currentSystemPrompt = getSystemPrompt(profile, customPrompt, false);
            initializeNewSession(profile, customPrompt);
            sendToRenderer('update-status', 'Text and screen ready. Configure Gemini for voice transcription.');
            return true;
        }
        const session = await initializeGeminiSession(apiKey, customPrompt, profile, language);
        if (session) {
            geminiSessionRef.current = session;
            return true;
        }
        return false;
    });

    ipcMain.handle('initialize-local', async (event, ollamaHost, ollamaModel, whisperModel, profile, customPrompt) => {
        currentProviderMode = 'local';
        const success = await getLocalAi().initializeLocalSession(ollamaHost, ollamaModel, whisperModel, profile, customPrompt);
        if (!success) {
            currentProviderMode = 'byok';
        }
        return success;
    });

    // Handle audio content — fire-and-forget (ipcRenderer.send) for lower latency
    const dispatchAudio = (source, data, mimeType) => {
        try {
            if (!require('./contextPolicy').resolve(getPreferences()).audio) return;
            const pcmBuffer = Buffer.from(data, 'base64');
            routeAudioChunk(currentAudioMode, source, pcmBuffer, ({ source: routedSource, chunk }) => {
                if (currentProviderMode === 'local') {
                    getLocalAi().processLocalAudio(chunk, mimeType, routedSource, currentAudioMode);
                } else if (hostedAudioSession) {
                    const rate = Number(/rate=(\d+)/.exec(mimeType || '')?.[1] || 24000);
                    hostedAudioSession.push(chunk, routedSource, rate);
                } else if (geminiSessionRef.current) {
                    if (isDebug) process.stdout.write(routedSource === 'speaker' ? '.' : ',');
                    geminiSessionRef.current.sendRealtimeInput({ audio: { data, mimeType } });
                }
            });
        } catch (error) {
            console.error(`Error processing ${source} audio:`, error);
        }
    };

    ipcMain.on('send-audio-content', (event, { data, mimeType }) => {
        dispatchAudio('speaker', data, mimeType);
    });

    // Handle microphone audio on a separate channel
    ipcMain.on('send-mic-audio-content', (event, { data, mimeType }) => {
        dispatchAudio('mic', data, mimeType);
    });

    ipcMain.handle('send-image-content', async (event, { data, prompt, automatic = false }) => {
        try {
            const policy = require('./contextPolicy').resolve(getPreferences());
            if (policy.screen === 'off' || (automatic && policy.screen !== 'automatic'))
                return { success: false, error: 'Screen sending is disabled by this context profile' };
            if (activeAnswerRequest) return { success: false, error: 'An answer is already running. Try again when it completes.' };
            if (!data || typeof data !== 'string' || data.length > 14000000) {
                console.error('Invalid image data received');
                return { success: false, error: 'Invalid image data' };
            }

            const buffer = Buffer.from(data, 'base64');

            if (buffer.length < 1000) {
                console.error(`Image buffer too small: ${buffer.length} bytes`);
                return { success: false, error: 'Image buffer too small' };
            }

            captureRecentScreenshot(data);

            if (isDebug) process.stdout.write('!');

            if (currentProviderMode === 'local') {
                const result = await getLocalAi().sendLocalImage(data, prompt);
                return result;
            }

            return await sendImageToGeminiHttp(data, prompt);
        } catch (error) {
            console.error('Error sending image:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-text-message', async (event, text) => {
        if (activeAnswerRequest) return { success: false, error: 'An answer is already running. Wait for it to finish.' };
        if (!text || typeof text !== 'string' || text.trim().length === 0 || text.length > 20000) {
            return { success: false, error: 'Invalid text message' };
        }
        manualQuestion = '';
        answerDebouncer.clear();

        if (currentProviderMode === 'local') {
            try {
                if (isDebug) console.log('Sending text to local Ollama:', text);
                return await getLocalAi().sendLocalText(text.trim());
            } catch (error) {
                console.error('Error sending local text:', error);
                return { success: false, error: error.message };
            }
        }

        // Text questions use the same answer-provider pipeline as screen analysis.
        // A hosted provider does not require a Gemini Live audio session to answer.
        if (currentProviderMode === 'byok') {
            try {
                const result = await sendToAnswerProvider(text.trim());
                return result?.text ? { success: true, model: result.model } : { success: false, error: result?.error || 'Answer cancelled' };
            } catch (error) {
                console.error('Error sending text to answer provider:', error);
                return { success: false, error: error.message };
            }
        }

        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };

        try {
            if (isDebug) console.log('Sending text message:', text);

            await geminiSessionRef.current.sendRealtimeInput({ text: text.trim() });
            return { success: true };
        } catch (error) {
            console.error('Error sending text:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-macos-audio', async event => {
        if (process.platform !== 'darwin') {
            return {
                success: false,
                error: 'macOS audio capture only available on macOS',
            };
        }

        try {
            const success = await startMacOSAudioCapture(geminiSessionRef);
            return { success };
        } catch (error) {
            console.error('Error starting macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('stop-macos-audio', async event => {
        try {
            stopMacOSAudioCapture();
            recentScreenshotStore.clear();
            return { success: true };
        } catch (error) {
            console.error('Error stopping macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('close-session', async event => {
        try {
            hostedAudioSession?.close();
            hostedAudioSession = null;
            answerDebouncer.clear();
            pendingAnswerRequest = null;
            cancelCurrentAnswer();
            currentSystemPrompt = null;
            recentScreenshotStore.clear();
            isUserClosing = true;
            // Generate session summary + extract memory facts (non-blocking, fire-and-forget)
            if (currentProviderMode !== 'local' && !getPreferences().privacyMode && conversationHistory.length >= 2) {
                const history = conversationHistory;
                const sid = currentSessionId;
                // Summary
                generateSessionSummary(history)
                    .then(summary => {
                        if (summary && sid) {
                            console.log('Session summary:', summary);
                            sendToRenderer('save-session-summary', { sessionId: sid, summary });
                        }
                    })
                    .catch(() => {});
                // Memory extraction (skipped when privacy mode is on)
                const prefs = getPreferences();
                if (!prefs.privacyMode) {
                    // Show one-time disclosure that session content is sent to the AI provider
                    if (!prefs.memoryExtractionNotified) {
                        sendToRenderer('provider-notification', {
                            type: 'success',
                            message: 'Memory: Learning new facts from this session (content sent to your AI provider).',
                        });
                        try {
                            updatePreference('memoryExtractionNotified', true);
                        } catch {
                            /* best-effort */
                        }
                    }
                    extractFactsFromSession(history)
                        .then(newFacts => {
                            if (newFacts.length > 0) {
                                const existing = getMemory();
                                const merged = mergeFacts(newFacts, existing);
                                saveMemory(merged);
                                console.log(`Memory: extracted ${newFacts.length} new facts (total: ${merged.length})`);
                            }
                        })
                        .catch(() => {});
                } else {
                    console.log('Memory extraction skipped (privacy mode active)');
                }
            }

            stopMacOSAudioCapture();

            if (currentProviderMode === 'local') {
                getLocalAi().closeLocalSession();
                currentProviderMode = 'byok';
                return { success: true };
            }

            // Set flag to prevent reconnection attempts
            isUserClosing = true;
            sessionParams = null;

            // Cleanup session
            if (geminiSessionRef.current) {
                await geminiSessionRef.current.close();
                geminiSessionRef.current = null;
            }

            return { success: true };
        } catch (error) {
            console.error('Error closing session:', error);
            return { success: false, error: error.message };
        }
    });

    // Conversation history IPC handlers
    ipcMain.handle('get-current-session', async event => {
        try {
            return { success: true, data: getCurrentSessionData() };
        } catch (error) {
            console.error('Error getting current session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-new-session', async event => {
        try {
            initializeNewSession();
            return { success: true, sessionId: currentSessionId };
        } catch (error) {
            console.error('Error starting new session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update-google-search-setting', async (event, enabled) => {
        try {
            console.log('Google Search setting updated to:', enabled);
            // The setting is already saved in localStorage by the renderer
            // This is just for logging/confirmation
            return { success: true };
        } catch (error) {
            console.error('Error updating Google Search setting:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    publishFinalQuestion,
    initializeGeminiSession,
    getEnabledTools,
    getStoredSetting,
    sendToRenderer,
    initializeNewSession,
    saveConversationTurn,
    getCurrentSessionData,
    killExistingSystemAudioDump,
    startMacOSAudioCapture,
    convertStereoToMono,
    stopMacOSAudioCapture,
    sendAudioToGemini,
    sendImageToGeminiHttp,
    setupGeminiIpcHandlers,
    formatSpeakerResults,
    sendToAnswerProvider,
    getNewUsageChars,
    getRecentConversationHistory,
    trimConversationHistoryForGemini,
    createSessionState,
    transitionTurn,
    TURN_STATE,
    setAudioMode,
    captureRecentScreenshot,
    getRecentScreenshot,
};
