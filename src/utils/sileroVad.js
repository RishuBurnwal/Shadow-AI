// Silero VAD (Voice Activity Detection) module
// Uses the Silero VAD ONNX model for robust speech/silence classification
// Replaces the simple RMS-threshold VAD with a trained neural voice detector
//
// Model: Silero VAD v5 (ONNX) - small, runs in real time on CPU
// Source: https://github.com/snakers4/silero-vad

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ort = require('onnxruntime-node');
const https = require('https');
const { app } = require('electron');

// ── Constants ──

const SILERO_VAD_URL = 'https://github.com/snakers4/silero-vad/raw/v5.1/files/silero_vad.onnx';
const MODEL_FILENAME = 'silero_vad.onnx';
const FRAME_SIZE = 512; // 32ms at 16kHz
const SAMPLE_RATE = 16000;
const THRESHOLD = 0.5; // Speech probability threshold
const MIN_SPEECH_FRAMES = 3; // Consecutive speech frames to trigger "speech started"

// Maximum number of redirects to follow when downloading the model.
// Prevents infinite redirect loops from a misconfigured URL.
const MAX_REDIRECTS = 5;

// Expected SHA-256 hash of the Silero VAD v5.1 ONNX model.
// Verified after download to detect corruption or man-in-the-middle tampering.
// Hash computed from: https://github.com/snakers4/silero-vad/raw/v5.1/files/silero_vad.onnx
const EXPECTED_SHA256 = 'd8398f012dc395a79ae8a97c20e19608041aebadddb2f18934164ae83b3dd8a4';

// ── State ──

let session = null;
let modelInitialized = false;
let modelDownloaded = false;

// ── Path helpers ──

function getModelDir() {
    try {
        return path.join(app.getPath('userData'), 'silero-vad-models');
    } catch {
        // Fallback for environments where app is not ready
        return path.join(__dirname, '..', '..', '.models', 'silero-vad');
    }
}

function getModelPath() {
    return path.join(getModelDir(), MODEL_FILENAME);
}

// ── Model Download ──

function computeSha256(filePath) {
    const data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
}

function downloadModel(url, destPath, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Check if already downloaded
        if (fs.existsSync(destPath)) {
            const stats = fs.statSync(destPath);
            if (stats.size > 100000) {
                // ~1.7MB expected — verify checksum
                const actualHash = computeSha256(destPath);
                if (actualHash === EXPECTED_SHA256) {
                    console.log('[SileroVAD] Model already cached at', destPath);
                    resolve(destPath);
                    return;
                }
                console.warn(
                    '[SileroVAD] Cached model checksum mismatch (expected',
                    EXPECTED_SHA256.slice(0, 12) + '...' + ', got',
                    actualHash.slice(0, 12) + '...' + '). Re-downloading.'
                );
                fs.unlinkSync(destPath);
            }
        }

        const tempPath = destPath + '.downloading';
        const file = fs.createWriteStream(tempPath);

        console.log('[SileroVAD] Downloading model from', url);

        https
            .get(url, response => {
                // Handle redirects
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    file.close();
                    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

                    // Enforce redirect cap to prevent infinite loops
                    if (redirectCount >= MAX_REDIRECTS) {
                        reject(new Error(`Too many redirects (${redirectCount + 1}), exceeded limit of ${MAX_REDIRECTS}`));
                        return;
                    }

                    downloadModel(response.headers.location, destPath, redirectCount + 1)
                        .then(resolve)
                        .catch(reject);
                    return;
                }

                if (response.statusCode !== 200) {
                    file.close();
                    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                    reject(new Error(`Download failed with status ${response.statusCode}`));
                    return;
                }

                response.pipe(file);

                file.on('finish', () => {
                    file.close();

                    // Verify SHA-256 checksum before accepting the downloaded file
                    const actualHash = computeSha256(tempPath);
                    if (actualHash !== EXPECTED_SHA256) {
                        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                        reject(
                            new Error(
                                `Downloaded model checksum mismatch. Expected ${EXPECTED_SHA256.slice(0, 12)}..., got ${actualHash.slice(0, 12)}...`
                            )
                        );
                        return;
                    }

                    fs.renameSync(tempPath, destPath);
                    console.log('[SileroVAD] Model downloaded and verified successfully');
                    resolve(destPath);
                });
            })
            .on('error', err => {
                file.close();
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                reject(err);
            });
    });
}

// ── Initialize ──

async function initializeSileroVAD(onDownloadStart) {
    if (modelInitialized && session) {
        return true;
    }

    try {
        const modelPath = getModelPath();
        // Notify caller when a network download is about to begin (model not cached)
        if (onDownloadStart && !fs.existsSync(modelPath)) {
            onDownloadStart();
        }
        await downloadModel(SILERO_VAD_URL, modelPath);

        console.log('[SileroVAD] Loading model from', modelPath);
        session = await ort.InferenceSession.create(modelPath, {
            executionProviders: ['cpu'],
        });
        modelDownloaded = true;
        modelInitialized = true;
        console.log('[SileroVAD] Model loaded successfully');
        return true;
    } catch (error) {
        console.error('[SileroVAD] Failed to initialize:', error.message);
        session = null;
        modelInitialized = false;
        return false;
    }
}

// ── VAD Processor ──

class VadProcessor {
    constructor() {
        this.hState = null; // GRU hidden state [2, 1, 64]
        this.cState = null; // GRU cell state [2, 1, 64]
        this.probability = 0;
        this.consecutiveSpeech = 0;
        this.consecutiveSilence = 0;
    }

    reset() {
        this.hState = null;
        this.cState = null;
        this.probability = 0;
        this.consecutiveSpeech = 0;
        this.consecutiveSilence = 0;
    }

    /**
     * Process a frame of audio and return the speech probability.
     * @param {Float32Array} audioFrame - Exactly 512 samples at 16kHz (32ms)
     * @returns {number} Speech probability (0-1)
     */
    async processFrame(audioFrame) {
        if (!session) return 0;

        try {
            // Prepare input tensors
            const inputTensor = new ort.Tensor('float32', audioFrame, [1, audioFrame.length]);

            // Initialize states on first call
            if (!this.hState) {
                this.hState = new Float32Array(2 * 64); // [2, 1, 64] total = 128
            }
            if (!this.cState) {
                this.cState = new Float32Array(2 * 64); // [2, 1, 64] total = 128
            }

            const hTensor = new ort.Tensor('float32', this.hState, [2, 1, 64]);
            const cTensor = new ort.Tensor('float32', this.cState, [2, 1, 64]);
            const srTensor = new ort.Tensor('int64', [BigInt(SAMPLE_RATE)], [1]);

            // Run inference
            const outputs = await session.run({
                input: inputTensor,
                h: hTensor,
                c: cTensor,
                sr: srTensor,
            });

            // Extract outputs
            this.probability = outputs.output.data[0];
            this.hState = outputs.hn.data;
            this.cState = outputs.cn.data;

            // Update frame counters
            if (this.probability > THRESHOLD) {
                this.consecutiveSpeech++;
                this.consecutiveSilence = 0;
            } else {
                this.consecutiveSilence++;
                this.consecutiveSpeech = 0;
            }

            return this.probability;
        } catch (error) {
            console.error('[SileroVAD] Inference error:', error.message);
            return 0;
        }
    }

    /**
     * Check if speech is currently detected (above threshold).
     */
    isSpeechDetected() {
        return this.probability > THRESHOLD;
    }

    /**
     * Check if speech just started (consecutive speech frames exceeded minimum).
     */
    didSpeechJustStart() {
        return this.consecutiveSpeech >= MIN_SPEECH_FRAMES && this.consecutiveSpeech - 1 < MIN_SPEECH_FRAMES;
    }

    /**
     * Check if silence just started (consecutive silence frames exceeded minimum).
     */
    didSilenceJustStart(silenceFramesRequired) {
        return this.consecutiveSilence >= silenceFramesRequired && this.consecutiveSilence - 1 < silenceFramesRequired;
    }

    /**
     * Get the current speech probability (for logging/debug).
     */
    getProbability() {
        return this.probability;
    }
}

/**
 * Check if Silero VAD is available (model loaded successfully).
 */
function isAvailable() {
    return modelInitialized && session !== null;
}

module.exports = {
    initializeSileroVAD,
    VadProcessor,
    isAvailable,
    FRAME_SIZE,
    SAMPLE_RATE,
    THRESHOLD,
};
