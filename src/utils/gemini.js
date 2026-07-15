const { GoogleGenAI } = require('@google/genai');
const { BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const { saveDebugAudio } = require('../audioUtils');
const { getSystemPrompt } = require('./prompts');
const {
    getAvailableModel,
    incrementLimitCount,
    getApiKey,
    getGroqApiKey,
    getCredentials,
    getPreferences,
    incrementCharUsage,
    getModelForToday,
    normalizeLanguageCode,
} = require('../storage');
const { connectCloud, sendCloudAudio, sendCloudText, sendCloudImage, closeCloud, isCloudActive, setOnTurnComplete } = require('./cloud');
const { getConfiguredProviders, streamWithFallback, markProviderSuccess, markProviderFailure } = require('./providerRouter');
const { syncProviderEnvironment } = require('./providerEnv');

// Lazy-loaded to avoid circular dependency (localai.js imports from gemini.js)
let _localai = null;
function getLocalAi() {
    if (!_localai) _localai = require('./localai');
    return _localai;
}

// Provider mode: 'byok', 'cloud', or 'local'
let currentProviderMode = 'byok';



// Session-scoped state (replaces module-level globals for B3)
let currentSession = null;

function createSessionState() {
    return {
        transcription: '',         // currentTranscription
        groqHistory: [],           // groqConversationHistory
        messageBuffer: '',         // messageBuffer
        answerFired: false,        // answerProviderFiredForTurn
        turnStart: 0,              // turnStartTime
        lastInputTime: 0,          // lastInputTranscriptionTime
    };
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
const isDebug = Boolean(process.env.SHADOW_AI_DEBUG) || Boolean(process.env.DEBUG);

// Barge-in support: external AbortController for the currently-streaming answer.
// When new speech is detected mid-answer, this is aborted to cancel the stream.
let _currentAnswerAbort = null;

function cancelCurrentAnswer() {
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
const GEMINI_LIVE_MODEL_CANDIDATES = [
    'gemini-2.5-flash-native-audio-preview-09-2025',
    'gemini-2.5-flash-live',
];

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
    const preferences = getPreferences();
    currentSessionId = Date.now().toString();
    currentSession = createSessionState();
    conversationHistory = [];
    screenAnalysisHistory = [];
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
    console.log('Saved conversation turn:', conversationTurn);

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
    console.log('Saved screen analysis:', analysisEntry);

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
    const tools = [];

    // Check if Google Search is enabled (default: true)
    const googleSearchEnabled = await getStoredSetting('googleSearchEnabled', 'true');
    console.log('Google Search enabled:', googleSearchEnabled);

    if (googleSearchEnabled === 'true') {
        tools.push({ googleSearch: {} });
        console.log('Added Google Search tool');
    } else {
        console.log('Google Search tool disabled');
    }

    return tools;
}

async function getStoredSetting(key, defaultValue) {
    try {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            // Wait a bit for the renderer to be ready
            await new Promise(resolve => setTimeout(resolve, 100));

            // Try to get setting from renderer process localStorage
            const value = await windows[0].webContents.executeJavaScript(`
                (function() {
                    try {
                        if (typeof localStorage === 'undefined') {
                            console.log('localStorage not available yet for ${key}');
                            return '${defaultValue}';
                        }
                        const stored = localStorage.getItem('${key}');
                        console.log('Retrieved setting ${key}:', stored);
                        return stored || '${defaultValue}';
                    } catch (e) {
                        console.error('Error accessing localStorage for ${key}:', e);
                        return '${defaultValue}';
                    }
                })()
            `);
            return value;
        }
    } catch (error) {
        console.error('Error getting stored setting for', key, ':', error.message);
    }
    console.log('Using default value for', key, ':', defaultValue);
    return defaultValue;
}

// helper to check if groq has been configured
function hasGroqKey() {
    const key = getGroqApiKey();
    return key && key.trim() != '';
}

function trimConversationHistoryForGemini(history, maxChars = 42000) {
    if (!history || history.length === 0) return [];
    let totalChars = 0;
    const trimmed = [];

    for (let i = history.length - 1; i >= 0; i--) {
        const turn = history[i];
        const turnChars = (turn.content || '').length;

        if (totalChars + turnChars > maxChars) break;
        totalChars += turnChars;
        trimmed.unshift(turn);
    }
    return trimmed;
}

function stripThinkingTags(text) {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

const { extractFactsFromSession, getMemory, mergeFacts, saveMemory } = require('../memory');

async function generateSessionSummary(history) {
    if (!history || history.length < 2) return '';

    const turns = history.map(t =>
        `User: ${(t.transcription || '').trim()}\nAssistant: ${(t.ai_response || '').trim()}`
    ).join('\n\n');
    if (!turns.trim()) return '';

    const summaryPrompt = `Summarize the following conversation in 1-2 sentences:\n\n${turns}\n\nSummary:`;

    try {
        const credentials = syncProviderEnvironment();
        const env = {
            ...process.env,
            GROQ_API_KEY: getGroqApiKey() || process.env.GROQ_API_KEY,
            GEMINI_API_KEY: getApiKey() || process.env.GEMINI_API_KEY,
            OPENROUTER_API_KEY: credentials.openrouterApiKey || process.env.OPENROUTER_API_KEY,
            OPENAI_API_KEY: credentials.openaiApiKey || process.env.OPENAI_API_KEY,
            PERPLEXITY_API_KEY: credentials.perplexityApiKey || process.env.PERPLEXITY_API_KEY,
            NVIDIA_API_KEY: credentials.nvidiaApiKey || process.env.NVIDIA_API_KEY,
        };
        const providers = getConfiguredProviders(env);
        const openaiProviders = providers.filter(p => (p.transport || 'openai') === 'openai');
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

async function sendToGroq(transcription) {
    // If there's an active answer being cancelled, skip starting a new one
    if (!_currentAnswerAbort || _currentAnswerAbort.signal.aborted) return;
    const groqApiKey = getGroqApiKey();
    if (!groqApiKey) {
        console.log('No Groq API key configured, skipping Groq response');
        return;
    }

    if (!transcription || transcription.trim() === '') {
        console.log('Empty transcription, skipping Groq');
        return;
    }

    const modelToUse = getModelForToday();
    if (!modelToUse) {
        console.log('All Groq daily limits exhausted');
        sendToRenderer('update-status', 'Groq limits reached for today');
        return;
    }

    if (isDebug) console.log(`Sending to Groq (${modelToUse}):`, transcription.substring(0, 100) + '...');

    const history = currentSession ? currentSession.groqHistory : [];
    history.push({
        role: 'user',
        content: transcription.trim(),
    });

    if (history.length > 20) {
        if (currentSession) currentSession.groqHistory = history.slice(-20);
    }

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${groqApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: modelToUse,
                messages: [{ role: 'system', content: currentSystemPrompt || 'You are a helpful assistant.' }, ...history],
                stream: true,
                temperature: 0.7,
                max_tokens: 1024,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Groq API error:', response.status, errorText);
            sendToRenderer('update-status', `Groq error: ${response.status}`);
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let isFirst = true;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(line => line.trim() !== '');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const json = JSON.parse(data);
                        const token = json.choices?.[0]?.delta?.content || '';
                        if (token) {
                            fullText += token;
                            const displayText = stripThinkingTags(fullText);
                            if (displayText) {
                                sendToRenderer(isFirst ? 'new-response' : 'update-response', displayText);
                                isFirst = false;
                            }
                        }
                    } catch (parseError) {
                        // Skip invalid JSON chunks
                    }
                }
            }
        }

        const cleanedResponse = stripThinkingTags(fullText);
        const modelKey = modelToUse.split('/').pop();

        const systemPromptChars = (currentSystemPrompt || 'You are a helpful assistant.').length;
        const history = currentSession ? currentSession.groqHistory : [];
        const historyChars = history.reduce((sum, msg) => sum + (msg.content || '').length, 0);
        const inputChars = systemPromptChars + historyChars;
        const outputChars = cleanedResponse.length;

        incrementCharUsage('groq', modelKey, inputChars + outputChars);

        if (cleanedResponse) {
            if (currentSession) currentSession.groqHistory.push({
                role: 'assistant',
                content: cleanedResponse,
            });

            saveConversationTurn(transcription, cleanedResponse);
        }

        console.log(`Groq response completed (${modelToUse})`);
        sendToRenderer('update-status', 'Listening...');
    } catch (error) {
        console.error('Error calling Groq API:', error);
        sendToRenderer('update-status', 'Groq error: ' + error.message);
    }
}

async function sendToGeminiText(transcription, appendUser = true) {
    // If answer was cancelled (barge-in), skip
    if (!_currentAnswerAbort || _currentAnswerAbort.signal.aborted) return null;

    const apiKey = getApiKey();
    if (!apiKey) {
        console.log('No Gemini API key configured');
        return;
    }

    if (!transcription || transcription.trim() === '') {
        console.log('Empty transcription, skipping Gemini');
        return;
    }

    const modelToUse = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (isDebug) console.log(`Sending to Gemini (${modelToUse}):`, transcription.substring(0, 100) + '...');

    const history = currentSession ? currentSession.groqHistory : [];
    if (appendUser) {
        history.push({
            role: 'user',
            content: transcription.trim(),
        });
    }

    const trimmedHistory = trimConversationHistoryForGemini(history, 42000);

    try {
        const ai = new GoogleGenAI({ apiKey: apiKey });

        const messages = trimmedHistory.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }],
        }));

        const systemPrompt = currentSystemPrompt || 'You are a helpful assistant.';
        const messagesWithSystem = [
            { role: 'user', parts: [{ text: systemPrompt }] },
            { role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] },
            ...messages,
        ];

        const response = await ai.models.generateContentStream({
            model: modelToUse,
            contents: messagesWithSystem,
        });

        let fullText = '';
        let isFirst = true;

        for await (const chunk of response) {
            const chunkText = chunk.text;
            if (chunkText) {
                fullText += chunkText;
                sendToRenderer(isFirst ? 'new-response' : 'update-response', fullText);
                isFirst = false;
            }
        }

        const systemPromptChars = (currentSystemPrompt || 'You are a helpful assistant.').length;
        const historyChars = trimmedHistory.reduce((sum, msg) => sum + (msg.content || '').length, 0);
        const inputChars = systemPromptChars + historyChars;
        const outputChars = fullText.length;

        incrementCharUsage('gemini', modelToUse, inputChars + outputChars);

        if (fullText.trim()) {
            if (currentSession) currentSession.groqHistory.push({
                role: 'assistant',
                content: fullText.trim(),
            });

            if (currentSession && currentSession.groqHistory.length > 40) {
                currentSession.groqHistory = currentSession.groqHistory.slice(-40);
            }

            saveConversationTurn(transcription, fullText);
        }

        console.log('Gemini response completed');
        markProviderSuccess('gemini');
        sendToRenderer('update-status', 'Listening...');
        return { provider: 'gemini', model: modelToUse, text: fullText };
    } catch (error) {
        markProviderFailure('gemini', error, error.status || 0);
        console.error('Error calling Gemini API:', error);
        sendToRenderer('update-status', 'Gemini error: ' + error.message);
        throw error;
    }
}

async function sendToAnswerProvider(transcription) {
    if (!transcription || !transcription.trim()) return;

    const credentials = syncProviderEnvironment();
    const env = {
        ...process.env,
        GROQ_API_KEY: getGroqApiKey() || process.env.GROQ_API_KEY,
        GEMINI_API_KEY: getApiKey() || process.env.GEMINI_API_KEY,
        OPENROUTER_API_KEY: credentials.openrouterApiKey || process.env.OPENROUTER_API_KEY,
        OPENAI_API_KEY: credentials.openaiApiKey || process.env.OPENAI_API_KEY,
        PERPLEXITY_API_KEY: credentials.perplexityApiKey || process.env.PERPLEXITY_API_KEY,
        NVIDIA_API_KEY: credentials.nvidiaApiKey || process.env.NVIDIA_API_KEY,
    };
    const providers = getConfiguredProviders(env);
    const genericProviders = providers.map(provider =>
        provider.id === 'groq' && !process.env.GROQ_MODEL ? { ...provider, model: getModelForToday() || provider.model } : provider
    );

    if (providers[0]?.id === 'gemini') {
        try {
            sendToRenderer('provider-notification', { type: 'success', message: 'Using Gemini.' });
            return await sendToGeminiText(transcription);
        } catch (error) {
            sendToRenderer('provider-notification', { type: 'warning', message: 'Gemini unavailable. Switching to hosted fallback.' });
            const history = currentSession ? currentSession.groqHistory : [];
            const lastMessage = history.at(-1);
            if (lastMessage?.role === 'user' && lastMessage.content === transcription.trim()) history.pop();
        }
    }

    if (!genericProviders.some(provider => provider.transport === 'openai')) {
        return sendToGeminiText(transcription);
    }

    const history = currentSession ? currentSession.groqHistory : [];
    history.push({ role: 'user', content: transcription.trim() });
    if (currentSession) currentSession.groqHistory = history.slice(-20);
    let isFirst = true;
    let fallbackOccurred = false;
    const providerLabel = provider =>
        ({ groq: 'Groq', openrouter: 'OpenRouter', openai: 'OpenAI', perplexity: 'Perplexity', nvidia: 'NVIDIA' })[provider] || provider;

    try {
        // Create a fresh abort controller for this answer stream (enables barge-in)
        _currentAnswerAbort = new AbortController();

        const result = await streamWithFallback({
            providers: genericProviders,
            messages: [{ role: 'system', content: currentSystemPrompt || 'You are a helpful assistant.' }, ...(currentSession ? currentSession.groqHistory : [])],
            onToken: (token, fullText) => {
                const displayText = stripThinkingTags(fullText);
                if (!displayText) return;
                sendToRenderer(isFirst ? 'new-response' : 'update-response', displayText);
                isFirst = false;
            },
            onProviderFailure: ({ provider, nextProvider, reason }) => {
                fallbackOccurred = true;
                const message = nextProvider
                    ? `${providerLabel(provider)} unavailable (${reason}). Switching to ${providerLabel(nextProvider)}.`
                    : `${providerLabel(provider)} unavailable (${reason}).`;
                sendToRenderer('provider-notification', { type: 'warning', message });
            },                onProviderSelected: ({ provider }) => {
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

        const cleanedResponse = stripThinkingTags(result.text);
        if (currentSession) currentSession.groqHistory.push({ role: 'assistant', content: cleanedResponse });
        saveConversationTurn(transcription, cleanedResponse);
        console.log(`Answer completed via ${result.provider} (${result.model})`);
        sendToRenderer('update-status', 'Listening...');
        return result;
    } catch (error) {
        // If the stream was cancelled due to barge-in, don't show error notifications
        if (error.name === 'AbortError' || error.message?.includes('abor')) {
            if (isDebug) console.log('[Barge-in] Answer stream cancelled, new turn starting');
            return null;
        }
        console.warn('Hosted answer providers failed:', error.failures || error.message);
        if (providers.some(provider => provider.id === 'gemini')) {
            sendToRenderer('provider-notification', { type: 'warning', message: 'Hosted providers unavailable. Switching to Gemini.' });
            try {
                return await sendToGeminiText(transcription, false);
            } catch {
                sendToRenderer('provider-notification', { type: 'warning', message: 'Every configured answer provider is currently unavailable.' });
            }
        }
        sendToRenderer('update-status', 'All configured answer providers failed');
        return null;
    }
}

async function initializeGeminiSession(apiKey, customPrompt = '', profile = 'interview', language = 'en-US', isReconnect = false) {
    apiKey = apiKey || process.env.GEMINI_API_KEY || '';
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

    const client = new GoogleGenAI({
        vertexai: false,
        apiKey: apiKey,
        httpOptions: { apiVersion: 'v1alpha' },
    });

    // Get enabled tools first to determine Google Search status
    const enabledTools = await getEnabledTools();
    const googleSearchEnabled = enabledTools.some(tool => tool.googleSearch);

    const systemPrompt = getSystemPrompt(profile, customPrompt, googleSearchEnabled);
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

    for (const model of modelCandidates) {
        try {
            session = await client.live.connect({
                model: model,
                callbacks: {
                    onopen: function () {
                        sendToRenderer('update-status', 'Live session connected');
                    },
                    onmessage: function (message) {
                        if (isDebug) {
                            console.log('----------------', message);
                        }

                        // Handle input transcription (what was spoken)
                        if (!currentSession) currentSession = createSessionState();
                        const s = currentSession;

                        const isInputTranscription = !!message.serverContent?.inputTranscription;

                        // Barge-in detection: if the user starts speaking while an answer is streaming,
                        // cancel the current answer stream and reset state for the new turn.
                        if (isInputTranscription && s.answerFired && !s.messageBuffer) {
                            if (isDebug) console.log('[Barge-in] User started speaking mid-answer, cancelling stream');
                            cancelCurrentAnswer();
                            // Reset state so the new turn can start fresh
                            s.answerFired = false;
                            s.transcription = '';
                            s.turnStart = 0;
                            s.lastInputTime = 0;
                            s.messageBuffer = '';
                            sendToRenderer('update-status', 'Listening... (interrupted)');
                        }

                        if (message.serverContent?.inputTranscription?.results) {
                            const formatted = formatSpeakerResults(message.serverContent.inputTranscription.results);
                            s.transcription += formatted;
                            if (formatted.trim()) {
                                sendToRenderer('interim-transcription', { text: s.transcription, isFinal: false });
                            }
                        } else if (message.serverContent?.inputTranscription?.text) {
                            const text = message.serverContent.inputTranscription.text;
                            if (text.trim() !== '') {
                                s.transcription += text;
                                sendToRenderer('interim-transcription', { text: s.transcription, isFinal: false });
                            }
                        }

                        // Track timing: whenever input transcription updates, note the time
                        if (message.serverContent?.inputTranscription) {
                            s.lastInputTime = Date.now();
                            if (s.turnStart === 0) {
                                s.turnStart = Date.now();
                            }
                        }

                        // Primary trigger: turnComplete fires when the user's turn is finished
                        if (message.serverContent?.turnComplete && !s.answerFired) {
                            // Send final transcription to caption bar before clearing
                            if (s.transcription.trim() !== '') {
                                sendToRenderer('interim-transcription', { text: s.transcription, isFinal: true });
                            }
                            s.answerFired = true;
                            if (s.transcription.trim() !== '') {
                                if (isDebug) {
                                    const inputToAnswerMs = Date.now() - (s.lastInputTime || s.turnStart);
                                    console.log(`[SHADOW_DEBUG] Input complete → answer call: ${inputToAnswerMs}ms`);
                                }
                                sendToAnswerProvider(s.transcription);
                                s.transcription = '';
                            }
                            s.messageBuffer = '';
                            sendToRenderer('update-status', 'Listening...');
                        }

                        // Fallback: generationComplete should also trigger if turnComplete was missed
                        if (message.serverContent?.generationComplete) {
                            if (!s.answerFired && s.transcription.trim() !== '') {
                                if (isDebug) {
                                    console.log('[SHADOW_DEBUG] Generation complete triggered answer (turnComplete was not received or was late)');
                                }
                                s.answerFired = true;
                                sendToAnswerProvider(s.transcription);
                                s.transcription = '';
                            }
                            s.answerFired = false; // Reset for next turn
                            s.messageBuffer = '';
                            // Reset timing for next turn
                            s.turnStart = 0;
                            s.lastInputTime = 0;
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
                    // AUDIO modality removed — we never play back Gemini's spoken reply.
                    // The actual answer comes from Groq/OpenRouter/etc. for speed.
                    // Requesting AUDIO caused Gemini to synthesize unused audio before
                    // signaling generationComplete, which gated the real answer (see audit F-01).
                    tools: enabledTools,
                    // Enable speaker diarization
                    inputAudioTranscription: {
                        enableSpeakerDiarization: true,
                        minSpeakerCount: 2,
                        maxSpeakerCount: 2,
                    },
                    contextWindowCompression: { slidingWindow: {} },
                    speechConfig: { languageCode: language },
                    systemInstruction: {
                        parts: [{ text: systemPrompt }],
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

    // Create fresh session state while preserving conversation history
    const oldHistory = currentSession ? currentSession.groqHistory : [];
    currentSession = createSessionState();
    currentSession.groqHistory = oldHistory;

    sendToRenderer('update-status', `Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    // Wait before attempting
    await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY));

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

            // Restore context from conversation history via text message
            const contextMessage = buildContextMessage();
            if (contextMessage) {
                try {
                    console.log('Restoring conversation context...');
                    await session.sendRealtimeInput({ text: contextMessage });
                } catch (contextError) {
                    console.error('Failed to restore context:', contextError);
                    // Continue without context - better than failing
                }
            }

            // Don't reset reconnectAttempts here - let it reset on next fresh session
            sendToRenderer('update-status', 'Reconnected! Listening...');
            console.log('Session reconnected successfully');
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

            const monoChunk = CHANNELS === 2 ? convertStereoToMono(chunk) : chunk;

            if (currentProviderMode === 'cloud') {
                sendCloudAudio(monoChunk);
            } else if (currentProviderMode === 'local') {
                getLocalAi().processLocalAudio(monoChunk);
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
    // Get available model based on rate limits
    const model = getAvailableModel();

    const apiKey = getApiKey();
    if (!apiKey) {
        return { success: false, error: 'No API key configured' };
    }

    try {
        const ai = new GoogleGenAI({ apiKey: apiKey });

        const contents = [
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Data,
                },
            },
            { text: prompt },
        ];

        console.log(`Sending image to ${model} (streaming)...`);
        const response = await ai.models.generateContentStream({
            model: model,
            contents: contents,
        });

        // Increment count after successful call
        incrementLimitCount(model);

        // Stream the response
        let fullText = '';
        let isFirst = true;
        for await (const chunk of response) {
            const chunkText = chunk.text;
            if (chunkText) {
                fullText += chunkText;
                // Send to renderer - new response for first chunk, update for subsequent
                sendToRenderer(isFirst ? 'new-response' : 'update-response', fullText);
                isFirst = false;
            }
        }

        console.log(`Image response completed from ${model}`);

        // Save screen analysis to history
        saveScreenAnalysis(prompt, fullText, model);

        return { success: true, text: fullText, model: model };
    } catch (error) {
        console.error('Error sending image to Gemini HTTP:', error);
        return { success: false, error: error.message };
    }
}

function setupGeminiIpcHandlers(geminiSessionRef) {
    // Store the geminiSessionRef globally for reconnection access
    global.geminiSessionRef = geminiSessionRef;

    ipcMain.handle('initialize-cloud', async (event, token, profile, userContext) => {
        try {
            currentProviderMode = 'cloud';
            initializeNewSession(profile);
            setOnTurnComplete((transcription, response) => {
                saveConversationTurn(transcription, response);
            });
            sendToRenderer('session-initializing', true);
            await connectCloud(token, profile, userContext);
            sendToRenderer('session-initializing', false);
            return true;
        } catch (err) {
            console.error('[Cloud] Init error:', err);
            currentProviderMode = 'byok';
            sendToRenderer('session-initializing', false);
            return false;
        }
    });

    ipcMain.handle('initialize-gemini', async (event, apiKey, customPrompt, profile = 'interview', language = 'en-US') => {
        currentProviderMode = 'byok';
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
    ipcMain.on('send-audio-content', (event, { data, mimeType }) => {
        try {
            const pcmBuffer = Buffer.from(data, 'base64');

            if (currentProviderMode === 'cloud') {
                sendCloudAudio(pcmBuffer);
            } else if (currentProviderMode === 'local') {
                getLocalAi().processLocalAudio(pcmBuffer);
            } else if (geminiSessionRef.current) {
                if (isDebug) process.stdout.write('.');
                geminiSessionRef.current.sendRealtimeInput({
                    audio: { data: data, mimeType: mimeType },
                }).catch(err => {
                    console.error('Error sending system audio:', err);
                });
            }
        } catch (error) {
            console.error('Error processing system audio:', error);
        }
    });

    // Handle microphone audio on a separate channel
    ipcMain.on('send-mic-audio-content', (event, { data, mimeType }) => {
        try {
            const pcmBuffer = Buffer.from(data, 'base64');

            if (currentProviderMode === 'cloud') {
                sendCloudAudio(pcmBuffer);
            } else if (currentProviderMode === 'local') {
                getLocalAi().processLocalAudio(pcmBuffer);
            } else if (geminiSessionRef.current) {
                if (isDebug) process.stdout.write(',');
                geminiSessionRef.current.sendRealtimeInput({
                    audio: { data: data, mimeType: mimeType },
                }).catch(err => {
                    console.error('Error sending mic audio:', err);
                });
            }
        } catch (error) {
            console.error('Error processing mic audio:', error);
        }
    });

    ipcMain.handle('send-image-content', async (event, { data, prompt }) => {
        try {
            if (!data || typeof data !== 'string') {
                console.error('Invalid image data received');
                return { success: false, error: 'Invalid image data' };
            }

            const buffer = Buffer.from(data, 'base64');

            if (buffer.length < 1000) {
                console.error(`Image buffer too small: ${buffer.length} bytes`);
                return { success: false, error: 'Image buffer too small' };
            }

            if (isDebug) process.stdout.write('!');

            if (currentProviderMode === 'cloud') {
                const sent = sendCloudImage(data);
                if (!sent) {
                    return { success: false, error: 'Cloud connection not active' };
                }
                return { success: true, model: 'cloud' };
            }

            if (currentProviderMode === 'local') {
                const result = await getLocalAi().sendLocalImage(data, prompt);
                return result;
            }

            // Use HTTP API instead of realtime session
            const result = await sendImageToGeminiHttp(data, prompt);
            return result;
        } catch (error) {
            console.error('Error sending image:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-text-message', async (event, text) => {
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return { success: false, error: 'Invalid text message' };
        }

        if (currentProviderMode === 'cloud') {
            try {
                console.log('Sending text to cloud:', text);
                sendCloudText(text.trim());
                return { success: true };
            } catch (error) {
                console.error('Error sending cloud text:', error);
                return { success: false, error: error.message };
            }
        }

        if (currentProviderMode === 'local') {
            try {
                console.log('Sending text to local Ollama:', text);
                return await getLocalAi().sendLocalText(text.trim());
            } catch (error) {
                console.error('Error sending local text:', error);
                return { success: false, error: error.message };
            }
        }

        if (!geminiSessionRef.current) return { success: false, error: 'No active Gemini session' };

        try {
            if (isDebug) console.log('Sending text message:', text);

            sendToAnswerProvider(text.trim());

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
            return { success: true };
        } catch (error) {
            console.error('Error stopping macOS audio capture:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('close-session', async event => {
        try {
            // Generate session summary + extract memory facts (non-blocking, fire-and-forget)
            if (conversationHistory.length >= 2) {
                const history = conversationHistory;
                const sid = currentSessionId;
                // Summary
                generateSessionSummary(history).then(summary => {
                    if (summary && sid) {
                        console.log('Session summary:', summary);
                        sendToRenderer('save-session-summary', { sessionId: sid, summary });
                    }
                }).catch(() => {});
                // Memory extraction
                extractFactsFromSession(history).then(newFacts => {
                    if (newFacts.length > 0) {
                        const existing = getMemory();
                        const merged = mergeFacts(newFacts, existing);
                        saveMemory(merged);
                        console.log(`Memory: extracted ${newFacts.length} new facts (total: ${merged.length})`);
                    }
                }).catch(() => {});
            }

            stopMacOSAudioCapture();

            if (currentProviderMode === 'cloud') {
                closeCloud();
                currentProviderMode = 'byok';
                return { success: true };
            }

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
};
