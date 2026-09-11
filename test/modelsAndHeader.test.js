const test = require('node:test');
const assert = require('node:assert/strict');
const { createPassthroughController } = require('../src/utils/passthrough');
const { enabledModels, isChatModel } = require('../src/utils/modelSelection');
const { getConfiguredProviders } = require('../src/utils/providerRouter');
test('passthrough polling restores header hit testing without renderer mouse events', () => {
    let point = { x: 140, y: 180 };
    let tick;
    let ignored;
    const win = {
        isDestroyed: () => false,
        getBounds: () => ({ x: 100, y: 100, width: 720, height: 500 }),
        setIgnoreMouseEvents: v => {
            ignored = v;
        },
        webContents: { send() {} },
    };
    const controller = createPassthroughController(win, {
        cursor: () => point,
        interval: fn => {
            tick = fn;
            return 1;
        },
        clear() {},
    });
    controller.setEnabled(true);
    assert.equal(ignored, true);
    point = { x: 140, y: 120 };
    tick();
    assert.equal(ignored, false);
    controller.setDragging(true);
    point.y = 280;
    tick();
    assert.equal(ignored, false);
    controller.setDragging(false);
    assert.equal(ignored, true);
    controller.setHeaderInteractive({ interactive: true, regions: [{ x: 0, y: 48, width: 250, height: 250 }] });
    tick();
    assert.equal(ignored, false);
    controller.setEnabled(false);
    assert.equal(ignored, false);
});
test('answer picker uses added models, while non-chat catalog entries cannot be added', () => {
    const p = { id: 'nvidia', model: 'chat' };
    assert.deepEqual(enabledModels(p, ['chat', 'other', 'embed-model'], {}, 'chat'), ['chat']);
    assert.deepEqual(enabledModels(p, ['chat', 'other'], { enabledProviderModels: { nvidia: ['other'] } }, 'chat'), ['other']);
    assert.deepEqual(enabledModels(p, ['chat'], { enabledProviderModels: { nvidia: [] } }, 'chat'), []);
    assert.deepEqual(enabledModels(p, ['chat'], { enabledProviderModels: { nvidia: ['previously-tested'] } }, 'chat'), ['previously-tested']);
    for (const model of ['text-embedding-3-small', 'whisper-1', 'nvidia/nemotron-parse']) assert.equal(isChatModel(model), false);
});
test('removing all models excludes a configured provider from answer requests', () => {
    assert.deepEqual(getConfiguredProviders({ NVIDIA_API_KEY: 'key' }, { enabledProviderModels: { nvidia: [] } }), []);
});

test('screenshot routing cannot silently use a removed model', () => {
    const env = { GROQ_API_KEY: 'key', GROQ_MODEL: 'qwen/qwen3.6-27b' };
    const [textOnly] = getConfiguredProviders(env, { enabledProviderModels: { groq: ['openai/gpt-oss-20b'] } });
    assert.equal(textOnly.model, 'openai/gpt-oss-20b');
    assert.equal(textOnly.vision, false);
    assert.equal(textOnly.visionModel, undefined);
    const [vision] = getConfiguredProviders(env, { enabledProviderModels: { groq: ['qwen/qwen3.6-27b'] } });
    assert.equal(vision.visionModel, 'qwen/qwen3.6-27b');
});
