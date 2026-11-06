import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createTaskToolRegistry } from '../js/task-tools.js';
import { createGuidanceAPI, guidanceSystemPrompt, taskCapabilityReport } from '../js/task-guidance.js';
import { connectTaskAssistant, describeTaskAssistant } from '../js/task-assistant.js';

function fixture() {
    // Self-description must not read or mutate workspace content.
    const workspace = new Proxy({ whenIdle: async () => {} }, {
        get(target, property) {
            assert.ok(['whenIdle', 'then'].includes(property), 'capability lookup must not inspect task data');
            return target[property];
        }
    });
    const tools = createTaskToolRegistry(async () => workspace);
    return { tools, prompts: createGuidanceAPI(tools) };
}

test('every built-in tool is covered by a grounded capability and discovery reads no workspace content', async () => {
    const api = fixture();
    const report = await api.tools.call('getCapabilities', {});
    assert.deepEqual(report, api.prompts.capabilities());
    assert.ok(api.tools.list().find(tool => tool.name === 'getCapabilities').annotations.readOnly);
    assert.deepEqual(report.additionalTools, [], 'new built-ins need capability classification');
    assert.deepEqual(new Set(report.capabilities.flatMap(group => group.tools)), new Set(report.toolNames));
    assert.ok(report.capabilities.every(group => group.available && group.missingTools.length === 0));
    assert.doesNotThrow(() => JSON.stringify(report));
    for (const item of [...report.capabilities, ...report.applicationOnly, ...report.wishlist]) {
        for (const reference of item.evidence) {
            await fs.access(new URL(`../${reference.split(':')[0]}`, import.meta.url));
        }
    }
    // The returned report cannot poison future prompts or capability requests.
    report.capabilities[0].tools.push('inventedTool');
    report.wishlist[0].iCannot = 'overwritten';
    assert.deepEqual(api.prompts.capabilities(), taskCapabilityReport(api.tools));
    assert.ok(!api.prompts.capabilities().capabilities[0].tools.includes('inventedTool'));
    assert.notEqual(api.prompts.capabilities().wishlist[0].iCannot, 'overwritten');
});

test('partial catalogs do not advertise missing powers and extensions do not silently satisfy wishlist needs', () => {
    const tools = { list: () => [{ name: 'listTasks' }] };
    const report = taskCapabilityReport(tools);
    assert.ok(report.capabilities.every(group => !group.available));
    assert.ok(report.capabilities.find(group => group.id === 'planning-records').missingTools.includes('createTask'));
    assert.doesNotMatch(guidanceSystemPrompt('smart', tools), /I can clarify Wants/);
    assert.match(guidanceSystemPrompt('smart', tools), /No getCapabilities tool is connected/);

    const api = fixture();
    api.tools.register({ name: 'searchWeb', description: 'Host extension', parameters: { type: 'object' }, annotations: { readOnly: true } }, () => []);
    const extended = api.prompts.capabilities();
    assert.deepEqual(extended.additionalTools, ['searchWeb']);
    assert.equal(extended.wishlist.find(item => item.id === 'research-and-file-context').priority, 'P2');
    assert.match(extended.extensionPolicy, /verify their behavior/);
});

test('every model tier and the actual adapter receive the same capability boundary and discovery route', async () => {
    const api = fixture();
    const meme = { setPrompterMode() {}, async ask() { return { text: 'Ready' }; } };
    assert.equal(describeTaskAssistant(api).adapter.guidanceConnected, false);
    const disconnect = await connectTaskAssistant(meme, api);
    assert.equal(describeTaskAssistant(api).adapter.guidanceConnected, true);
    assert.equal(meme.systemPrompt, guidanceSystemPrompt('smart', api.tools));
    assert.deepEqual(await meme.tools.find(tool => tool.name === 'getCapabilities').handler({}), api.prompts.capabilities());
    for (const modelTier of ['simple', 'small', 'smart', 'supersmart']) {
        const prepared = await api.prompts.prepare('conversation', { modelTier });
        assert.ok(prepared.prompt.startsWith(guidanceSystemPrompt(modelTier, api.tools)));
        assert.match(prepared.prompt, /Use getCapabilities\(\{\}\)/);
        assert.match(prepared.prompt, /Named agents and agent timers do not run tasks/);
    }
    disconnect();
    assert.equal(describeTaskAssistant(api).adapter.guidanceConnected, false);
});
