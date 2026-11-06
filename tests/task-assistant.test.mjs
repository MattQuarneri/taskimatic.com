import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { connectTaskAssistant, installTaskAssistant } from '../js/task-assistant.js';
import { createTaskToolRegistry } from '../js/task-tools.js';
import { createGuidanceAPI, PROCESS_STEPS } from '../js/task-guidance.js';

function fixture() {
    const saved = [];
    const tools = createTaskToolRegistry(async () => ({
        createPlanning(kind, input) { const record = { id: 'saved', ...input }; saved.push(record); return record; }
    }));
    const api = { tools, prompts: createGuidanceAPI(tools) };
    const meme = {
        _tools: [], scripts: {}, mode: 'type', requests: [],
        set tools(entries) {
            for (const entry of entries) {
                assert.equal(typeof entry.handler, 'function');
                assert.equal(entry.inputSchema.type, 'object');
                assert.ok(['none', 'unsafe'].includes(entry.effect));
            }
            this._tools = entries;
        },
        get tools() { return this._tools; },
        setPrompterMode(mode) { this.mode = mode; },
        async ask(prompt) { this.requests.push({ prompt, mode: this.mode }); return { text: 'Ready' }; },
        startListening() { throw Error('The adapter must not start microphone capture'); }
    };
    return { api, meme, saved };
}

test('assistant adapts the real tool catalog and shares maintained instructions, Tap tree and registered intro', async () => {
    const { api, meme, saved } = fixture();
    await connectTaskAssistant(meme, api);
    assert.equal(meme.tools.length, api.tools.list().length);
    assert.equal(meme.tools.find(tool => tool.name === 'listTasks').effect, 'none');
    assert.equal(meme.tools.find(tool => tool.name === 'createTask').effect, 'unsafe');
    await meme.tools.find(tool => tool.name === 'createWant').handler({ input: { text: 'Ship' } });
    assert.equal(saved[0].text, 'Ship');
    await assert.rejects(meme.tools.find(tool => tool.name === 'createWant').handler({ input: { typo: true } }));
    for (const step of PROCESS_STEPS) assert.equal(meme.taptree[step.label].prompt, step.prompt);
    assert.doesNotMatch(JSON.stringify(meme.taptree), /saveWant|getGoals|saveSubTasks/);
    assert.equal(meme.intro, 'intro');
    const intro = await meme.scripts[meme.intro]();
    assert.ok(intro.includes('Welcome the user to Taskimatic'));
    assert.ok(meme.systemPrompt.includes('SAVING AND TOOL USE'));
});

test('Guide forwards each input mode and prepared context; errors and cancelled requests remain visible', async () => {
    const { api, meme } = fixture();
    const disconnect = await connectTaskAssistant(meme, api);
    assert.equal(api.prompts.connected, true);
    for (const mode of ['type', 'talk', 'tap']) {
        const options = { mode, userInput: 'My draft' };
        const prepared = await api.prompts.prepare('clarify-want', options);
        await api.prompts.start('clarify-want', options);
        assert.deepEqual(meme.requests.at(-1), { prompt: prepared.prompt, mode });
    }
    meme.ask = async () => { throw Error('provider failed'); };
    await assert.rejects(api.prompts.start('welcome'), /provider failed/);
    meme.ask = async () => null;
    await assert.rejects(api.prompts.start('welcome'), /did not complete/);
    disconnect();
    assert.equal(api.prompts.connected, false);
});

test('entry JSON-LD parses and assistant initializer is installed before its external loader is appended', async () => {
    const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
    const json = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(json['@type'], 'WebApplication');
    assert.ok(html.indexOf('name="taskimatic-assistant"') < html.indexOf('</head>'));
    assert.doesNotMatch(html, /<script[^>]*src="https:\/\/lan\.taskimatic/);
    const previous = { window: globalThis.window, document: globalThis.document };
    const { api, meme } = fixture();
    let appended;
    globalThis.window = { taskimatic: api };
    globalThis.document = {
        baseURI: 'https://taskimatic.test/',
        querySelector: () => ({ content: 'https://companion.test/meme.js' }),
        createElement: () => ({ dataset: {} }),
        body: { append(script) { assert.equal(typeof window.initMeme, 'function'); appended = script; } }
    };
    try {
        installTaskAssistant();
        assert.equal(appended.src, 'https://companion.test/meme.js?init=initMeme');
        await window.initMeme(meme);
        assert.equal(api.prompts.connected, true);
        document.querySelector = () => null;
        appended = null;
        installTaskAssistant();
        assert.equal(appended, null, 'portable copies never load external assistant assets');
    } finally { Object.assign(globalThis, previous); }
});
