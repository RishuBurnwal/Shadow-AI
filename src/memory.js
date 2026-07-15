// memory.js — Dynamic memory store
//
// The assistant learns new facts about the user over time from session
// transcripts. Facts are stored encrypted at rest via Electron's safeStorage
// (same pattern as soul.js) and include timestamps for recency ranking.
//
// Fact schema:
//   { id, fact, category, source, createdAt, updatedAt }
//
// Dedup: facts with the same normalized (category + fact key) are merged —
// the newer fact overrides the older one.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let _safeStorage = null;
function getSafeStorage() {
    if (_safeStorage === undefined) {
        try {
            _safeStorage = require('electron').safeStorage;
        } catch {
            _safeStorage = null;
        }
    }
    return _safeStorage;
}

const ENCRYPTION_MARKER = '_encrypted';
const MARKER_VALUE = 'v1';
const MAX_FACTS = 200;

function getMemoryPath() {
    const { getConfigDir } = require('./storage');
    return path.join(getConfigDir(), 'memory.json');
}

function readJsonFile(filePath, defaultValue) {
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch {
        // ignore corrupt/invalid
    }
    return defaultValue;
}

function writeJsonFile(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error writing memory:', error.message);
        return false;
    }
}

function generateId() {
    return Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
}

// Normalize a fact for dedup: lowercased category + first 80 chars of fact
function factKey(fact, category) {
    return `${(category || 'other').toLowerCase()}::${(fact || '').toLowerCase().trim().slice(0, 80)}`;
}

// ── CRUD ──

function getMemory() {
    const raw = readJsonFile(getMemoryPath(), null);
    if (!raw || !raw.facts) return [];
    if (!raw[ENCRYPTION_MARKER]) return raw.facts || []; // legacy plaintext

    const safeStorage = getSafeStorage();
    const decrypted = [];
    for (const entry of raw.facts) {
        if (!entry || !entry._enc) {
            decrypted.push(entry); // already plaintext
            continue;
        }
        if (safeStorage && safeStorage.isEncryptionAvailable()) {
            try {
                const buf = Buffer.from(entry._enc, 'base64');
                const json = safeStorage.decryptString(buf);
                decrypted.push(JSON.parse(json));
            } catch {
                // skip corrupt entry
            }
        }
    }
    return decrypted;
}

function saveMemory(facts) {
    const safeStorage = getSafeStorage();
    const encrypted = facts.map(f => {
        if (safeStorage && safeStorage.isEncryptionAvailable()) {
            try {
                const json = JSON.stringify(f);
                const buf = safeStorage.encryptString(json);
                return { _enc: buf.toString('base64') };
            } catch {
                return { ...f };
            }
        }
        return { ...f };
    });
    return writeJsonFile(getMemoryPath(), {
        [ENCRYPTION_MARKER]: MARKER_VALUE,
        facts: encrypted,
    });
}

function deleteMemory() {
    const p = getMemoryPath();
    try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
        return true;
    } catch {
        return false;
    }
}

function clearMemory() {
    return saveMemory([]);
}

// ── MERGE / DEDUP ──

// Merge an array of new facts into the existing memory store.
// Dedup by (category + normalized fact text): newer fact overrides older.
// Newer facts with a different key are simply appended.
// Returns the merged array (does NOT persist — caller must saveMemory).
function mergeFacts(newFacts, existing) {
    const now = Date.now();
    const map = new Map();
    for (const f of existing) {
        map.set(factKey(f.fact, f.category), f);
    }
    for (const f of newFacts) {
        const key = factKey(f.fact, f.category);
        const existing = map.get(key);
        if (existing) {
            // Override: keep the newer timestamps
            existing.fact = f.fact;
            existing.category = f.category || existing.category;
            existing.updatedAt = now;
        } else {
            map.set(key, {
                id: generateId(),
                fact: f.fact,
                category: f.category || 'other',
                source: f.source || 'auto-extracted',
                createdAt: now,
                updatedAt: now,
            });
        }
    }
    const merged = [...map.values()];
    if (merged.length > MAX_FACTS) {
        // Keep the MAX_FACTS most recently updated
        merged.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return merged.slice(0, MAX_FACTS);
    }
    return merged;
}

// ── LLM EXTRACTION ──

const EXTRACTION_PROMPT = `You are a memory extraction assistant. Given a conversation transcript, extract new facts about the user (the person speaking as "User:" or "Candidate:" or similar).

Only extract facts that are:
1. Explicitly stated by the user (not the assistant)
2. Factual and specific (not generic opinions)
3. Relevant to the user's background, skills, preferences, goals, or experience

Categories: "skill", "preference", "background", "project", "goal", "other"

Return as JSON array of { fact, category } objects. Each fact should be a single, concise statement (max 100 chars).
If no new facts are found, return an empty array [].

Examples:
Input: "User: I've been working with React for 3 years now"
Output: [{"fact": "Has 3 years of React experience", "category": "skill"}]

Input: "User: I prefer remote work and async communication"
Output: [{"fact": "Prefers remote work", "category": "preference"}, {"fact": "Prefers async communication", "category": "preference"}]

Input: "User: I'm targeting backend roles at fintech companies"
Output: [{"fact": "Targeting backend roles in fintech", "category": "goal"}]

Conversation:
-----
{{CONVERSATION}}
-----

Return only the JSON array, nothing else.`;

async function extractFactsFromSession(history) {
    if (!history || history.length < 2) return [];

    const turns = history.map(t =>
        `User: ${(t.transcription || '').trim()}\nAssistant: ${(t.ai_response || '').trim()}`
    ).join('\n\n');
    if (!turns.trim()) return [];

    const prompt = EXTRACTION_PROMPT.replace('{{CONVERSATION}}', turns);

    try {
        const { streamWithFallback } = require('./providerRouter');
        const { syncProviderEnvironment } = require('./providerEnv');
        const { getGroqApiKey, getApiKey } = require('./storage');

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
        const { getConfiguredProviders } = require('./providerRouter');
        const providers = getConfiguredProviders(env);
        const openaiProviders = providers.filter(p => (p.transport || 'openai') === 'openai');
        if (openaiProviders.length === 0) return [];

        const result = await streamWithFallback({
            providers: openaiProviders,
            messages: [{ role: 'user', content: prompt }],
            onToken: () => {},
        });

        const text = result.text.trim();
        // Find JSON array in the response (handle markdown fences or extra text)
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) return [];
        const parsed = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(item => item.fact && item.fact.trim());
    } catch {
        return [];
    }
}

function updateMemoryEntry(id, updates) {
    const facts = getMemory();
    const idx = facts.findIndex(f => f.id === id);
    if (idx === -1) return false;
    facts[idx] = { ...facts[idx], ...updates, updatedAt: Date.now() };
    return saveMemory(facts);
}

function deleteMemoryEntry(id) {
    const facts = getMemory();
    const idx = facts.findIndex(f => f.id === id);
    if (idx === -1) return false;
    facts.splice(idx, 1);
    return saveMemory(facts);
}

function getProfileForDisplay() {
    try {
        const { getProfile } = require('./soul');
        return getProfile();
    } catch {
        return null;
    }
}

module.exports = {
    getMemory,
    saveMemory,
    deleteMemory,
    clearMemory,
    mergeFacts,
    extractFactsFromSession,
    updateMemoryEntry,
    deleteMemoryEntry,
    getProfileForDisplay,
};
