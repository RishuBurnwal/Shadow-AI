/**
 * AudioChunkProcessor — AudioWorkletProcessor for efficient audio capture.
 *
 * Replaces the deprecated ScriptProcessorNode with an AudioWorkletNode
 * that runs in a dedicated audio thread, preventing main-thread UI work
 * from causing audio dropouts.
 *
 * Converts Float32 audio data (from Web Audio API) into 16-bit PCM
 * chunks and posts them to the main renderer thread for IPC transport.
 */

const CHUNK_DURATION = 0.1; // seconds — matches AUDIO_CHUNK_DURATION in renderer.js

class AudioChunkProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.audioBuffer = []; // Float32 accumulation buffer
        this.channelName = options?.processorOptions?.channelName || 'send-audio-content';
        this.mimeType = options?.processorOptions?.mimeType || 'audio/pcm;rate=24000';
        this.samplesPerChunk = Math.floor((options?.processorOptions?.sampleRate || 24000) * CHUNK_DURATION);
    }

    /**
     * Called by the audio engine on each render quantum (128 frames).
     * @param {Array<Array<Float32Array>>} inputs - [[channelData, ...], ...]
     * @param {Array<Array<Float32Array>>} outputs
     * @param {Record<string, Float32Array>} parameters
     * @returns {boolean} true to keep the processor alive
     */
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0] || input[0].length === 0) {
            return true; // Keep alive even when silent
        }

        const channelData = input[0]; // Float32Array of audio samples

        // Accumulate samples
        for (let i = 0; i < channelData.length; i++) {
            this.audioBuffer.push(channelData[i]);
        }

        // Flush full chunks from the buffer
        while (this.audioBuffer.length >= this.samplesPerChunk) {
            const chunk = this.audioBuffer.splice(0, this.samplesPerChunk);
            const int16Data = this._convertFloat32ToInt16(chunk);

            // Post the Int16Array buffer to the main thread (transferable for zero-copy)
            this.port.postMessage(
                {
                    type: 'audio-chunk',
                    channelName: this.channelName,
                    mimeType: this.mimeType,
                    data: int16Data.buffer,
                    sampleCount: int16Data.length,
                },
                [int16Data.buffer] // Transfer ownership for zero-copy
            );
        }

        return true; // Keep processor alive
    }

    /**
     * Convert Float32 samples (-1 to 1) to 16-bit PCM.
     */
    _convertFloat32ToInt16(float32Array) {
        const len = float32Array.length;
        const int16 = new Int16Array(len);
        for (let i = 0; i < len; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        return int16;
    }
}

registerProcessor('audio-chunk-processor', AudioChunkProcessor);
