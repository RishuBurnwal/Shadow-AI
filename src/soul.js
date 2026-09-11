// soul.js — Static user profile store ("Soul" foundation)
//
// Stores user background info (name, target role, skills, etc.) encrypted
// at rest via Electron's safeStorage, following the same pattern as
// encrypted credentials in storage.js.
//
// Fields:
//   name              — User's full name
//   targetRole        — Target job title / role
//   experienceSummary — Brief career summary (2-3 sentences)
//   keySkills[]       — Array of key skills
//   pastProjects[]    — Array of project descriptions
//   preferredTone     — "professional" | "casual" | "formal"
//   resumeText        — Optional full resume text (pasted)

const fs = require('fs');
const path = require('path');

let _safeStorage;
function getSafeStorage() {
    if (_safeStorage === undefined) {
        try {
            _safeStorage = process.versions.electron ? require('electron').safeStorage : null;
        } catch {
            _safeStorage = null;
        }
    }
    return _safeStorage;
}

const ENCRYPTION_MARKER = '_encrypted';
const MARKER_VALUE = 'v2';

const DEFAULT_PROFILE = {
    name: '',
    targetRole: '',
    experienceSummary: '',
    keySkills: [],
    pastProjects: [],
    preferredTone: 'professional',
    resumeText: '',
};

function getProfilePath() {
    const { getConfigDir } = require('./storage');
    return path.join(getConfigDir(), 'profile.json');
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
        console.error('Error writing profile:', error.message);
        return false;
    }
}

function getProfile() {
    const raw = readJsonFile(getProfilePath(), null);
    if (!raw) return { ...DEFAULT_PROFILE };

    // Legacy plaintext — migrate on read
    if (!raw[ENCRYPTION_MARKER]) {
        const profile = { ...DEFAULT_PROFILE };
        for (const key of Object.keys(DEFAULT_PROFILE)) {
            if (raw[key] !== undefined) profile[key] = raw[key];
        }
        if (getSafeStorage()?.isEncryptionAvailable()) setProfile(profile); // migrate only when encryption is available
        return profile;
    }

    // Encrypted format
    const safeStorage = getSafeStorage();
    const profile = { ...DEFAULT_PROFILE };
    let decryptionFailed = false;
    for (const key of Object.keys(DEFAULT_PROFILE)) {
        const val = raw[key];
        if (val && typeof val === 'string' && val.length > 0) {
            if (safeStorage && safeStorage.isEncryptionAvailable()) {
                try {
                    const buf = Buffer.from(val, 'base64');
                    const decrypted = safeStorage.decryptString(buf);
                    const defaultVal = DEFAULT_PROFILE[key];
                    profile[key] = Array.isArray(defaultVal) ? JSON.parse(decrypted) : decrypted;
                } catch {
                    decryptionFailed = true;
                    const fallback = Array.isArray(DEFAULT_PROFILE[key])
                        ? (() => {
                              try {
                                  return JSON.parse(val);
                              } catch {
                                  return [];
                              }
                          })()
                        : val;
                    profile[key] = raw[ENCRYPTION_MARKER] === 'v1' && !val.startsWith('AQAA') ? fallback : DEFAULT_PROFILE[key];
                }
            } else {
                decryptionFailed = true;
                // safeStorage unavailable — try reading plaintext fallback
                const defaultVal = DEFAULT_PROFILE[key];
                try {
                    profile[key] = raw[ENCRYPTION_MARKER] === 'v1' ? (Array.isArray(defaultVal) ? JSON.parse(val) : val) : defaultVal;
                } catch {
                    profile[key] = defaultVal;
                }
            }
        }
    }
    if (decryptionFailed) {
        if (raw[ENCRYPTION_MARKER] === 'v1' && safeStorage?.isEncryptionAvailable()) setProfile(profile);
        console.warn(
            '[Profile] Some profile fields could not be decrypted (safeStorage unavailable or key changed). Check your profile in AI Customization > About Me.'
        );
    }
    return profile;
}

function setProfile(profile) {
    const safeStorage = getSafeStorage();
    if (!safeStorage?.isEncryptionAvailable())
        throw new Error('Secure profile storage is unavailable. Unlock your operating system keychain and retry.');
    const encrypted = {};
    for (const key of Object.keys(DEFAULT_PROFILE)) {
        const value = profile[key] ?? DEFAULT_PROFILE[key];
        const normalized = Array.isArray(DEFAULT_PROFILE[key])
            ? Array.isArray(value)
                ? value.filter(item => typeof item === 'string').slice(0, 100)
                : []
            : String(value).slice(0, key === 'resumeText' ? 50000 : 6000);
        encrypted[key] = safeStorage.encryptString(typeof normalized === 'string' ? normalized : JSON.stringify(normalized)).toString('base64');
    }
    encrypted[ENCRYPTION_MARKER] = MARKER_VALUE;
    if (!writeJsonFile(getProfilePath(), encrypted)) throw new Error('Could not save profile');
    return true;
}

function deleteProfile() {
    const p = getProfilePath();
    try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
        return true;
    } catch {
        return false;
    }
}

module.exports = { getProfile, setProfile, deleteProfile, DEFAULT_PROFILE };
