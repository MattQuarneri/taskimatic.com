import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../tasks-sw.js', import.meta.url), 'utf8');
function worker(addAll) {
    const events = {};
    let activated = false;
    vm.runInNewContext(source, {
        URL, Request,
        self: {location: {href: 'https://taskimatic.test/t/tasks-sw.js'},
            addEventListener(type, callback) { events[type] = callback; },
            async skipWaiting() { activated = true; }},
        caches: {open: async () => ({addAll})}
    });
    let installation;
    events.install({waitUntil(promise) {installation = promise;}});
    return {installation, activated: () => activated};
}

test('a complete shell activates without waiting for every open tab to close', async () => {
    let complete;
    const download = new Promise(resolve => { complete = resolve; });
    const installed = worker(() => download);
    assert.equal(installed.activated(), false);
    complete();
    await installed.installation;
    assert.equal(installed.activated(), true);
});

test('an incomplete shell never replaces the working offline app', async () => {
    const installed = worker(async () => { throw new Error('asset download failed'); });
    await assert.rejects(installed.installation, /asset download failed/);
    assert.equal(installed.activated(), false);
});
