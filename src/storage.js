const fs = require('fs');
const path = require('path');
const os = require('os');

// Lazy-loaded safeStorage reference (may not be available in all contexts)
let _safeStorage;
function getSafeStorage() {
    if (_safeStorage === undefined) {
        _safeStorage = process.versions.electron ? require('electron').safeStorage : null;
    }
    return _safeStorage;
}

const CONFIG_VERSION = 2;

// Default values
const DEFAULT_CONFIG = {
    configVersion: CONFIG_VERSION,
    onboarded: false,
    layout: 'normal',
};

const { defaultCredentials } = require('./utils/providers.config');

const DEFAULT_CREDENTIALS = defaultCredentials();

const DEFAULT_PREFERENCES = {
    customPrompt: '',
    sessionName: '',
    sessionNote: '',
    providerMode: 'byok',
    answerProvider: 'default',
    providerModels: {},
    selectedProfile: 'interview',
    selectedLanguage: 'en-US',
    selectedScreenshotInterval: '5',
    selectedImageQuality: 'medium',
    advancedMode: false,
    audioMode: 'speaker_only',
    fontSize: 'medium',
    backgroundTransparency: 0.8,
    responseTextOpacity: 1,
    responseTextColor: '#f5f5f5',
    googleSearchEnabled: false,
    ollamaHost: 'http://127.0.0.1:11434',
    ollamaModel: 'llama3.1',
    whisperModel: 'Xenova/whisper-small',
    vadSilenceMs: 500,
    privacyMode: false,
    promptSkills: [],
};

function normalizeLanguageCode(value) {
    const language = String(value || '').trim();
    if (!language || language.toLowerCase() === 'auto') return DEFAULT_PREFERENCES.selectedLanguage;
    if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) return DEFAULT_PREFERENCES.selectedLanguage;
    return language;
}

const DEFAULT_KEYBINDS = null; // null means use system defaults

const DEFAULT_LIMITS = {
    data: [], // Daily provider/model usage counters.
};

// Get the config directory path based on OS
function getConfigDir() {
    // Allow overriding via env var (used in tests)
    if (process.env.SHADOW_AI_CONFIG_DIR) {
        return path.resolve(process.env.SHADOW_AI_CONFIG_DIR);
    }

    const platform = os.platform();
    let configDir;

    if (platform === 'win32') {
        configDir = path.join(os.homedir(), 'AppData', 'Roaming', 'shadow-ai-config');
    } else if (platform === 'darwin') {
        configDir = path.join(os.homedir(), 'Library', 'Application Support', 'shadow-ai-config');
    } else {
        configDir = path.join(os.homedir(), '.config', 'shadow-ai-config');
    }

    return configDir;
}

// File paths
function getConfigPath() {
    return path.join(getConfigDir(), 'config.json');
}

function getCredentialsPath() {
    return path.join(getConfigDir(), 'credentials.json');
}

function getPreferencesPath() {
    return path.join(getConfigDir(), 'preferences.json');
}

function getKeybindsPath() {
    return path.join(getConfigDir(), 'keybinds.json');
}

function getLimitsPath() {
    return path.join(getConfigDir(), 'limits.json');
}

function getHistoryDir() {
    return path.join(getConfigDir(), 'history');
}

// Helper to read JSON file safely
function readJsonFile(filePath, defaultValue) {
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.warn(`Error reading ${filePath}:`, error.message);
    }
    return defaultValue;
}

// Helper to write JSON file safely
function writeJsonFile(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error(`Error writing ${filePath}:`, error.message);
        return false;
    }
}

// ── Additive config migration system ──
//
// Instead of wiping data on version mismatch (old behavior), we run
// sequential migration functions. Each function receives the existing
// data and returns the upgraded version. Only truly corrupt files
// fall back to defaults.

const CONFIG_MIGRATIONS = {
    // v0 (no version field) → v1: add version and required fields
    0: data => ({
        ...data,
        configVersion: 1,
        onboarded: data.onboarded ?? false,
        layout: data.layout || 'normal',
    }),
    // v1 → v2: placeholder — all existing fields preserved
    1: data => ({
        ...data,
        configVersion: 2,
    }),
};

const PREFERENCES_MIGRATIONS = {
    // v0 (any pre-migration preferences) → current defaults merged over existing
    0: data => ({
        ...DEFAULT_PREFERENCES,
        ...data,
        selectedLanguage: normalizeLanguageCode(data.selectedLanguage),
    }),
};

function getCurrentVersion(data) {
    if (!data || typeof data !== 'object') return 0;
    const v = Number(data.configVersion);
    return Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * Run pending migrations on the config object and return the upgraded version.
 */
function runConfigMigrations(data) {
    let version = getCurrentVersion(data);
    while (version < CONFIG_VERSION) {
        const migration = CONFIG_MIGRATIONS[version];
        if (!migration) {
            // No migration defined for this version — skip to avoid infinite loops
            console.warn(`No migration defined for config version ${version}, skipping to ${CONFIG_VERSION}`);
            break;
        }
        try {
            data = migration(data);
            version = Number(data.configVersion) || version + 1;
        } catch (err) {
            console.error(`Config migration v${version} failed:`, err.message);
            throw err;
        }
    }
    return data;
}

/**
 * Run pending migrations on a preferences object.
 */
function runPreferencesMigrations(data) {
    // Preferences don't carry a version key — always merge defaults on top
    // to ensure new default fields appear even for old files.
    return PREFERENCES_MIGRATIONS[0](data || {});
}

/**
 * Write default config, credentials, and preferences to disk.
 * Used only for fresh installs or after corrupt-data recovery.
 */
function writeDefaults() {
    const configDir = getConfigDir();
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(getHistoryDir(), { recursive: true });

    writeJsonFile(getConfigPath(), DEFAULT_CONFIG);
    writeJsonFile(getCredentialsPath(), DEFAULT_CREDENTIALS);
    writeJsonFile(getPreferencesPath(), DEFAULT_PREFERENCES);
}

/**
 * Initialize storage — runs automatically on app startup.
 *
 * - No config file → write defaults (fresh install)
 * - Corrupt config → warn, write defaults (safe fallback)
 * - Old version → run pending migrations in order, preserving user data
 * - Current version → nothing (just ensure dirs exist)
 */
function initializeStorage() {
    const configPath = getConfigPath();
    const configDir = getConfigDir();

    if (!fs.existsSync(configPath)) {
        // Fresh install — write defaults
        writeDefaults();
        return;
    }

    // Read existing config and run migrations
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
        // Corrupt file — fall back to defaults
        console.warn('Config file corrupt, reverting to defaults:', err.message);
        writeDefaults();
        return;
    }

    const currentVersion = getCurrentVersion(raw);

    if (currentVersion < CONFIG_VERSION) {
        try {
            raw = runConfigMigrations(raw);
            writeJsonFile(getConfigPath(), raw);
        } catch (err) {
            // Migration failed — safe fallback
            console.warn('Config migration failed, reverting to defaults:', err.message);
            writeDefaults();
            return;
        }
    }

    // Also migrate preferences file if it exists
    const prefsPath = getPreferencesPath();
    if (fs.existsSync(prefsPath)) {
        try {
            const prefsRaw = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
            const migratedPrefs = runPreferencesMigrations(prefsRaw);
            writeJsonFile(prefsPath, migratedPrefs);
        } catch {
            // Corrupt preferences — silently overwrite with defaults
            writeJsonFile(prefsPath, DEFAULT_PREFERENCES);
        }
    }

    // Ensure directories exist
    if (!fs.existsSync(getHistoryDir())) {
        fs.mkdirSync(getHistoryDir(), { recursive: true });
    }
}

// ============ CONFIG ============

function getConfig() {
    return readJsonFile(getConfigPath(), DEFAULT_CONFIG);
}

function setConfig(config) {
    const current = getConfig();
    const updated = { ...current, ...config, configVersion: CONFIG_VERSION };
    return writeJsonFile(getConfigPath(), updated);
}

function updateConfig(key, value) {
    const config = getConfig();
    config[key] = value;
    return writeJsonFile(getConfigPath(), config);
}

// ============ CREDENTIALS (encrypted at rest via Electron safeStorage) ============

const CREDENTIALS_ENCRYPTION_MARKER = '_encrypted';
const CREDENTIALS_MARKER_VALUE = 'v1';

/**
 * Get credentials, decrypting values stored with safeStorage.
 * Automatically migrates legacy plaintext credentials on first read.
 */
function getCredentials() {
    const raw = readJsonFile(getCredentialsPath(), null);

    // First-time: no file yet → return defaults
    if (raw === null) {
        return { ...DEFAULT_CREDENTIALS };
    }

    // Legacy plaintext format or no encryption marker → migrate in memory, write back
    if (!raw[CREDENTIALS_ENCRYPTION_MARKER]) {
        const credentials = { ...DEFAULT_CREDENTIALS };
        for (const key of Object.keys(DEFAULT_CREDENTIALS)) {
            credentials[key] = raw[key] || '';
        }
        // Re-save encrypted (this calls setCredentials which encrypts)
        setCredentials(credentials);
        return credentials;
    }

    // Encrypted format — decrypt each value
    const safeStorage = getSafeStorage();
    const credentials = { ...DEFAULT_CREDENTIALS };
    let decryptionFailed = false;
    for (const key of Object.keys(DEFAULT_CREDENTIALS)) {
        const encryptedBase64 = raw[key];
        if (encryptedBase64 && typeof encryptedBase64 === 'string' && encryptedBase64.length > 0) {
            if (safeStorage && safeStorage.isEncryptionAvailable()) {
                try {
                    const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');
                    credentials[key] = safeStorage.decryptString(encryptedBuffer);
                } catch {
                    decryptionFailed = true;
                    credentials[key] = '';
                }
            } else {
                decryptionFailed = true;
                credentials[key] = '';
            }
        }
    }
    if (decryptionFailed) {
        console.warn(
            '[Credentials] Some stored credentials could not be decrypted (safeStorage unavailable or key changed). Values reset to empty. Re-enter your API keys in Settings.'
        );
    }
    return credentials;
}

/**
 * Save credentials, encrypting each value with safeStorage when available.
 * Merges with existing credentials so setting a single key doesn't wipe others.
 */
function setCredentials(credentials) {
    // Read existing credentials from disk and merge
    const existing = readJsonFile(getCredentialsPath(), {});
    const isExistingEncrypted = existing[CREDENTIALS_ENCRYPTION_MARKER];

    // Build the plaintext merged credentials
    const merged = { ...DEFAULT_CREDENTIALS };
    for (const key of Object.keys(DEFAULT_CREDENTIALS)) {
        // If the new call provides this key, use it; otherwise try existing (decrypt if needed)
        if (credentials[key] !== undefined) {
            merged[key] = credentials[key] || '';
        } else if (existing[key]) {
            if (isExistingEncrypted) {
                // Try to decrypt existing value
                const safeStorage = getSafeStorage();
                if (safeStorage && safeStorage.isEncryptionAvailable()) {
                    try {
                        const encryptedBuffer = Buffer.from(existing[key], 'base64');
                        merged[key] = safeStorage.decryptString(encryptedBuffer);
                    } catch {
                        merged[key] = '';
                    }
                } else {
                    merged[key] = '';
                }
            } else {
                merged[key] = existing[key] || '';
            }
        }
    }

    const safeStorage = getSafeStorage();
    const encrypted = {};

    if (safeStorage && safeStorage.isEncryptionAvailable()) {
        // Encrypt each value
        for (const key of Object.keys(DEFAULT_CREDENTIALS)) {
            const value = merged[key];
            if (value && typeof value === 'string' && value.length > 0) {
                try {
                    const encryptedBuffer = safeStorage.encryptString(value);
                    encrypted[key] = encryptedBuffer.toString('base64');
                } catch {
                    encrypted[key] = '';
                }
            } else {
                encrypted[key] = '';
            }
        }
        encrypted[CREDENTIALS_ENCRYPTION_MARKER] = CREDENTIALS_MARKER_VALUE;
    } else {
        if (process.versions.electron) {
            throw new Error('Secure credential storage is unavailable. API keys were not saved.');
        }
        // Headless tests have no OS keychain; production Electron never reaches this branch.
        for (const key of Object.keys(DEFAULT_CREDENTIALS)) {
            encrypted[key] = merged[key] || '';
        }
    }

    return writeJsonFile(getCredentialsPath(), encrypted);
}

function getApiKey() {
    return getCredentials().apiKey || '';
}

function setApiKey(apiKey) {
    return setCredentials({ apiKey });
}

function getGroqApiKey() {
    return getCredentials().groqApiKey || '';
}

function setGroqApiKey(groqApiKey) {
    return setCredentials({ groqApiKey });
}

// ============ PREFERENCES ============

function getPreferences() {
    const saved = readJsonFile(getPreferencesPath(), {});
    return { ...DEFAULT_PREFERENCES, ...saved, selectedLanguage: normalizeLanguageCode(saved.selectedLanguage) };
}

function setPreferences(preferences) {
    const current = getPreferences();
    const updated = {
        ...current,
        ...preferences,
        selectedLanguage: normalizeLanguageCode(preferences?.selectedLanguage ?? current.selectedLanguage),
    };
    return writeJsonFile(getPreferencesPath(), updated);
}

function updatePreference(key, value) {
    const preferences = getPreferences();
    preferences[key] = key === 'selectedLanguage' ? normalizeLanguageCode(value) : value;
    return writeJsonFile(getPreferencesPath(), preferences);
}

// ============ KEYBINDS ============

function getKeybinds() {
    return readJsonFile(getKeybindsPath(), DEFAULT_KEYBINDS);
}

function setKeybinds(keybinds) {
    return writeJsonFile(getKeybindsPath(), keybinds);
}

// ============ LIMITS (Rate Limiting) ============

function getLimits() {
    return readJsonFile(getLimitsPath(), DEFAULT_LIMITS);
}

function setLimits(limits) {
    return writeJsonFile(getLimitsPath(), limits);
}

function getTodayDateString() {
    const now = new Date();
    return now.toISOString().split('T')[0]; // YYYY-MM-DD
}

function getTodayLimits() {
    const limits = getLimits();
    const today = getTodayDateString();

    // Find today's entry
    const todayEntry = limits.data.find(entry => entry.date === today);

    if (todayEntry) {
        // ensure new fields exist
        if (!todayEntry.groq) {
            todayEntry.groq = {
                'qwen3-32b': { chars: 0, limit: 1500000 },
                'gpt-oss-120b': { chars: 0, limit: 600000 },
                'gpt-oss-20b': { chars: 0, limit: 600000 },
                'kimi-k2-instruct': { chars: 0, limit: 600000 },
            };
        }
        if (!todayEntry.gemini) {
            todayEntry.gemini = {
                'gemini-2.5-flash': { chars: 0 },
            };
        }
        setLimits(limits);
        return todayEntry;
    }

    // No entry for today - clean old entries and create new one
    limits.data = limits.data.filter(entry => entry.date === today);
    const newEntry = {
        date: today,
        flash: { count: 0 },
        flashLite: { count: 0 },
        groq: {
            'qwen3-32b': { chars: 0, limit: 1500000 },
            'gpt-oss-120b': { chars: 0, limit: 600000 },
            'gpt-oss-20b': { chars: 0, limit: 600000 },
            'kimi-k2-instruct': { chars: 0, limit: 600000 },
        },
        gemini: {
            'gemini-2.5-flash': { chars: 0 },
        },
    };
    limits.data.push(newEntry);
    setLimits(limits);

    return newEntry;
}

function incrementLimitCount(model) {
    const limits = getLimits();
    const today = getTodayDateString();

    // Find or create today's entry
    let todayEntry = limits.data.find(entry => entry.date === today);

    if (!todayEntry) {
        // Clean old entries and create new one
        limits.data = [];
        todayEntry = {
            date: today,
            flash: { count: 0 },
            flashLite: { count: 0 },
        };
        limits.data.push(todayEntry);
    } else {
        // Clean old entries, keep only today
        limits.data = limits.data.filter(entry => entry.date === today);
    }

    // Increment the appropriate model count
    if (model === 'gemini-2.5-flash') {
        todayEntry.flash.count++;
    } else if (model === 'gemini-2.5-flash-lite') {
        todayEntry.flashLite.count++;
    }

    setLimits(limits);
    return todayEntry;
}

function incrementCharUsage(provider, model, charCount) {
    getTodayLimits();

    const limits = getLimits();
    const today = getTodayDateString();
    const todayEntry = limits.data.find(entry => entry.date === today);

    if (todayEntry[provider]) {
        if (!todayEntry[provider][model]) todayEntry[provider][model] = { chars: 0 };
        todayEntry[provider][model].chars += charCount;
        setLimits(limits);
    }

    return todayEntry;
}

function getAvailableModel() {
    const todayLimits = getTodayLimits();

    // RPD limits: flash = 20, flash-lite = 20
    // After both exhausted, fall back to flash (for paid API users)
    if (todayLimits.flash.count < 20) {
        return 'gemini-2.5-flash';
    } else if (todayLimits.flashLite.count < 20) {
        return 'gemini-2.5-flash-lite';
    }

    return 'gemini-2.5-flash'; // Default to flash for paid API users
}

function getModelForToday() {
    const todayEntry = getTodayLimits();
    const groq = todayEntry.groq;

    if (groq['qwen3-32b'].chars < groq['qwen3-32b'].limit) {
        return 'qwen/qwen3-32b';
    }
    if (groq['gpt-oss-120b'].chars < groq['gpt-oss-120b'].limit) {
        return 'openai/gpt-oss-120b';
    }
    if (groq['gpt-oss-20b'].chars < groq['gpt-oss-20b'].limit) {
        return 'openai/gpt-oss-20b';
    }
    if (groq['kimi-k2-instruct'].chars < groq['kimi-k2-instruct'].limit) {
        return 'moonshotai/kimi-k2-instruct';
    }

    // All limits exhausted
    return null;
}

// ============ HISTORY ============

function getSessionPath(sessionId) {
    const safeSessionId = String(sessionId || '').trim();
    if (!/^\d{10,20}$/.test(safeSessionId)) throw new Error('Invalid session ID');
    return path.join(getHistoryDir(), `${safeSessionId}.json`);
}

function sanitizeSessionText(value, maxLength) {
    return String(value ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function saveSession(sessionId, data) {
    const sessionPath = getSessionPath(sessionId);

    // Load existing session to preserve metadata
    const existingSession = readJsonFile(sessionPath, null);

    const sessionData = {
        sessionId,
        createdAt: existingSession?.createdAt || parseInt(sessionId),
        lastUpdated: Date.now(),
        // Profile context - set once when session starts
        profile: data.profile || existingSession?.profile || null,
        customPrompt: data.customPrompt || existingSession?.customPrompt || null,
        sessionName: data.sessionName !== undefined ? sanitizeSessionText(data.sessionName, 120) : existingSession?.sessionName || '',
        sessionNote: data.sessionNote !== undefined ? sanitizeSessionText(data.sessionNote, 2000) : existingSession?.sessionNote || '',
        // Conversation data
        conversationHistory: data.conversationHistory || existingSession?.conversationHistory || [],
        screenAnalysisHistory: data.screenAnalysisHistory || existingSession?.screenAnalysisHistory || [],
    };
    return writeJsonFile(sessionPath, sessionData);
}

function getSession(sessionId) {
    return readJsonFile(getSessionPath(sessionId), null);
}

function getAllSessions() {
    const historyDir = getHistoryDir();

    try {
        if (!fs.existsSync(historyDir)) {
            return [];
        }

        const files = fs
            .readdirSync(historyDir)
            .filter(f => f.endsWith('.json'))
            .sort((a, b) => {
                // Sort by timestamp descending (newest first)
                const tsA = parseInt(a.replace('.json', ''));
                const tsB = parseInt(b.replace('.json', ''));
                return tsB - tsA;
            });

        return files
            .map(file => {
                const sessionId = file.replace('.json', '');
                const data = readJsonFile(path.join(historyDir, file), null);
                if (data) {
                    return {
                        sessionId,
                        createdAt: data.createdAt,
                        lastUpdated: data.lastUpdated,
                        messageCount: data.conversationHistory?.length || 0,
                        screenAnalysisCount: data.screenAnalysisHistory?.length || 0,
                        profile: data.profile || null,
                        customPrompt: data.customPrompt || null,
                        sessionName: data.sessionName || '',
                        sessionNote: data.sessionNote || '',
                    };
                }
                return null;
            })
            .filter(Boolean);
    } catch (error) {
        console.error('Error reading sessions:', error.message);
        return [];
    }
}

function deleteSession(sessionId) {
    const sessionPath = getSessionPath(sessionId);
    try {
        if (fs.existsSync(sessionPath)) {
            fs.unlinkSync(sessionPath);
            return true;
        }
    } catch (error) {
        console.error('Error deleting session:', error.message);
    }
    return false;
}

function deleteAllSessions() {
    const historyDir = getHistoryDir();
    try {
        if (fs.existsSync(historyDir)) {
            const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json'));
            files.forEach(file => {
                fs.unlinkSync(path.join(historyDir, file));
            });
        }
        return true;
    } catch (error) {
        console.error('Error deleting all sessions:', error.message);
        return false;
    }
}

// ============ CLEAR ALL DATA ============

function clearAllData() {
    const configDir = getConfigDir();
    if (fs.existsSync(configDir)) {
        fs.rmSync(configDir, { recursive: true, force: true });
    }
    writeDefaults();
    return true;
}

module.exports = {
    // Initialization
    initializeStorage,
    getConfigDir,

    // Config
    getConfig,
    setConfig,
    updateConfig,

    // Credentials
    getCredentials,
    setCredentials,
    getApiKey,
    setApiKey,
    getGroqApiKey,
    setGroqApiKey,

    // Preferences
    getPreferences,
    setPreferences,
    updatePreference,

    normalizeLanguageCode,
    // Keybinds
    getKeybinds,
    setKeybinds,

    // Limits (Rate Limiting)
    getLimits,
    setLimits,
    getTodayLimits,
    incrementLimitCount,
    getAvailableModel,
    incrementCharUsage,
    getModelForToday,

    // History
    saveSession,
    getSession,
    getAllSessions,
    deleteSession,
    deleteAllSessions,

    // Clear all
    clearAllData,
};
