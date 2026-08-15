const AUDIO_SOURCE_LABELS = Object.freeze({ speaker: 'Interviewer', mic: 'Candidate' });

function routeAudioChunk(mode, source, chunk, deliver) {
    if (!Object.hasOwn(AUDIO_SOURCE_LABELS, source)) return false;
    const enabled = mode === 'both' || (mode === 'speaker_only' && source === 'speaker') || (mode === 'mic_only' && source === 'mic');
    if (!enabled) return false;
    deliver({ source, label: AUDIO_SOURCE_LABELS[source], chunk });
    return true;
}

function labelTranscript(source, text) {
    const label = AUDIO_SOURCE_LABELS[source];
    const normalized = String(text || '').trim();
    return label && normalized ? `[${label}] ${normalized}` : normalized;
}

module.exports = { AUDIO_SOURCE_LABELS, routeAudioChunk, labelTranscript };
