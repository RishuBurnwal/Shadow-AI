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
        setProfile(profile); // re-save encrypted
        return profile;
    }

    // Encrypted format
    const safeStorage = getSafeStorage();
    const profile = { ...DEFAULT_PROFILE };
    for (const key of Object.keys(DEFAULT_PROFILE)) {
        const val = raw[key];
        if (val && typeof val === 'string' && val.length > 0) {
            if (safeStorage && safeStorage.isEncryptionAvailable()) {
                try {
                    const buf = Buffer.from(val, 'base64');
                    const decrypted = safeStorage.decryptString(buf);
                    // Strings stored directly; arrays/objects were JSON.stringify'd
                    const defaultVal = DEFAULT_PROFILE[key];
                    profile[key] = Array.isArray(defaultVal) ? JSON.parse(decrypted) : decrypted;
                } catch {
                    profile[key] = DEFAULT_PROFILE[key];
                }
            }
        }
    }
    return profile;
}

function setProfile(profile) {
    const safeStorage = getSafeStorage();
    const encrypted = {};

    for (const key of Object.keys(DEFAULT_PROFILE)) {
        const val = profile[key] !== undefined ? profile[key] : DEFAULT_PROFILE[key];
        if (safeStorage && safeStorage.isEncryptionAvailable()) {
            try {
                // Only JSON.stringify for complex types; strings go directly
                const raw = typeof val === 'string' ? val : JSON.stringify(val);
                const buf = safeStorage.encryptString(raw);
                encrypted[key] = buf.toString('base64');
            } catch {
                encrypted[key] = typeof val === 'string' ? val : JSON.stringify(val);
            }
        } else {
            encrypted[key] = typeof val === 'string' ? val : JSON.stringify(val);
        }
    }
    encrypted[ENCRYPTION_MARKER] = MARKER_VALUE;
    return writeJsonFile(getProfilePath(), encrypted);
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
