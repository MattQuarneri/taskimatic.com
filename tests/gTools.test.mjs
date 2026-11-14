import test from 'node:test';
import assert from 'node:assert/strict';
import { gTools } from '../js/gTools.js';
import { createTaskToolRegistry } from '../js/task-tools.js';

function withMockBrowser({ token = 'test-token' } = {}) {
    const prev = { indexedDB: globalThis.indexedDB, fetch: globalThis.fetch };
    const requests = [];

    const storeData = new Map([
        ['google_calendar_token', { id: 'google_calendar_token', token }],
        ['google_calendar_client_id', { id: 'google_calendar_client_id', clientId: 'test-client.apps.googleusercontent.com' }]
    ]);

    globalThis.indexedDB = {
        open() {
            const req = {};
            queueMicrotask(() => {
                const db = {
                    objectStoreNames: { contains: () => true },
                    close() {},
                    transaction() {
                        const tx = {};
                        return {
                            objectStore() {
                                return {
                                    get(key) {
                                        const getReq = {};
                                        queueMicrotask(() => {
                                            getReq.result = storeData.get(key) || null;
                                            getReq.onsuccess?.();
                                            tx.oncomplete?.();
                                        });
                                        return getReq;
                                    },
                                    put(val) {
                                        storeData.set(val.id, val);
                                        queueMicrotask(() => tx.oncomplete?.());
                                    },
                                    delete(key) {
                                        storeData.delete(key);
                                        queueMicrotask(() => tx.oncomplete?.());
                                    }
                                };
                            },
                            set oncomplete(fn) { tx.oncomplete = fn; },
                            get oncomplete() { return tx.oncomplete; },
                            set onerror(fn) { tx.onerror = fn; },
                            set onabort(fn) { tx.onabort = fn; }
                        };
                    }
                };
                req.result = db;
                req.onsuccess?.();
            });
            return req;
        }
    };

    globalThis.fetch = async (url, options = {}) => {
        requests.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
        if (url.includes('people:searchContacts')) {
            return { ok: true, status: 200, text: async () => JSON.stringify({ results: [{ person: { resourceName: 'people/123' } }] }) };
        }
        if (url.includes('/tasks/v1/lists/') && (options.method || 'GET') === 'GET') {
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    items: [
                        { id: 't1', title: 'Review Q4 Launch Plan' },
                        { id: 't2', title: 'Buy groceries' },
                        { id: 't3', title: 'Plan Q4 team offsite' }
                    ]
                })
            };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ items: [{ id: 'item-1' }], id: 'created-1' }) };
    };

    return {
        requests,
        restore: () => Object.assign(globalThis, prev)
    };
}

test('gTools agent tools gate writes and deletes behind approval while reads run directly', async () => {
    const { requests, restore } = withMockBrowser();
    const prompts = [];
    let allow = false;

    try {
        const tools = gTools.getAgentTools({
            requireApproval: true,
            confirm: async (details) => {
                prompts.push(details);
                return allow;
            }
        });

        const findTool = tools.find((t) => t.name === 'google_contacts_find');
        assert.equal(findTool.effect, 'none');
        const found = await findTool.execute({ query: 'Ada' });
        assert.equal(found.length, 1);
        assert.equal(prompts.length, 0);
        assert.ok(requests[0].url.includes('people:searchContacts?query=Ada'));

        const createEventTool = tools.find((t) => t.name === 'google_calendar_new_event');
        assert.equal(createEventTool.effect, 'unsafe');
        await assert.rejects(createEventTool.execute({ summary: 'Blocked Event' }), /User rejected/);
        assert.equal(prompts.length, 1);
        assert.equal(prompts[0].actionType, 'create');
        assert.equal(requests.length, 1, 'Rejected write must not call Google API');

        allow = true;
        const created = await createEventTool.execute({ summary: 'Approved Event' });
        assert.equal(created.id, 'created-1');
        assert.equal(prompts.length, 2);
        assert.equal(requests.length, 2);
        assert.equal(requests[1].method, 'POST');
        assert.equal(requests[1].body.summary, 'Approved Event');
    } finally {
        restore();
    }
});

test('gTools registers cleanly with Taskimatic tool registry and normalizes Tasks due dates', async () => {
    const { requests, restore } = withMockBrowser();
    try {
        const registry = createTaskToolRegistry(async () => ({}));
        const tools = gTools.registerWith(registry, { confirm: async () => true });
        assert.ok(registry.list().some((t) => t.name === 'google_tasks_create'));
        assert.equal(tools.length, 24);

        await registry.call('google_tasks_move', { taskId: 't2', parent: 't1' });
        assert.equal(requests[0].method, 'POST');
        assert.ok(requests[0].url.includes('/tasks/t2/move?parent=t1'));

        await registry.call('google_calendar_get_colors', {});
        assert.ok(requests[1].url.endsWith('/calendar/v3/colors'));

        await registry.call('google_calendar_new_scheduled_task', { title: 'Focus Block', durationMinutes: 45 });
        assert.equal(requests[2].method, 'POST');
        assert.equal(requests[2].body.summary, '☐ Focus Block');
        assert.equal(requests[2].body.extendedProperties.private.gToolsKind, 'scheduledTask');

        await registry.call('google_tasks_create', { title: 'Ship gTools', due: '2026-11-20' });
        assert.equal(requests[3].method, 'POST');
        assert.equal(requests[3].body.due, '2026-11-20T00:00:00.000Z');

        const matches = await gTools.tasks.find('plan q4');
        assert.deepEqual(matches.map((m) => m.id), ['t1', 't3']);

        const listRes = await registry.call('google_tasks_create_list', { title: 'Work' });
        assert.equal(listRes.id, 'created-1');
        assert.equal(requests[5].body.title, 'Work');
    } finally {
        restore();
    }
});

test('contacts create, get labels, and add label run without approval while remove label requires approval', async () => {
    const { requests, restore } = withMockBrowser();
    const prompts = [];
    let allow = false;
    try {
        const tools = gTools.getAgentTools({
            requireApproval: true,
            confirm: async (details) => {
                prompts.push(details);
                return allow;
            }
        });
        const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

        await byName.google_contacts_create.execute({ displayName: 'Ada Lovelace', email: 'ada@example.com' });
        await byName.google_contacts_get_labels.execute({});
        await byName.google_contacts_add_label.execute({ labelResourceName: 'vip', contactResourceNames: ['123'] });
        assert.equal(prompts.length, 0);
        assert.equal(requests.length, 3);
        assert.ok(requests[2].url.endsWith('/contactGroups/vip/members:modify'));
        assert.deepEqual(requests[2].body, { resourceNamesToAdd: ['people/123'] });

        await assert.rejects(
            byName.google_contacts_remove_label.execute({ labelResourceName: 'contactGroups/vip', contactResourceNames: ['people/123'] }),
            /User rejected/
        );
        assert.equal(prompts.length, 1);
        assert.equal(requests.length, 3);

        allow = true;
        await byName.google_contacts_remove_label.execute({ labelResourceName: 'contactGroups/vip', contactResourceNames: ['people/123'] });
        assert.equal(prompts.length, 2);
        assert.equal(requests.length, 4);
        assert.deepEqual(requests[3].body, { resourceNamesToRemove: ['people/123'] });
    } finally {
        restore();
    }
});

test('batch approval window coalesces clustered calls and supports selective row approval', async () => {
    const { requests, restore } = withMockBrowser();
    const batches = [];
    try {
        const tools = gTools.getAgentTools({
            requireApproval: true,
            batchWindowMs: 40,
            promptBatch: async (items) => {
                batches.push(items);
                // Approve 1st and 3rd, reject 2nd
                return [true, false, true];
            }
        });
        const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

        const p1 = byName.google_tasks_create.execute({ title: 'Task A' });
        await new Promise((r) => setTimeout(r, 15));
        const p2 = byName.google_tasks_update.execute({ taskId: 't2', patch: { title: 'Task B' } });
        await new Promise((r) => setTimeout(r, 15));
        const p3 = byName.google_calendar_delete_event.execute({ eventId: 'e3' });

        const results = await Promise.allSettled([p1, p2, p3]);
        assert.equal(batches.length, 1, 'All 3 calls within sliding window should coalesce into 1 batch');
        assert.equal(batches[0].length, 3);
        assert.equal(results[0].status, 'fulfilled');
        assert.equal(results[1].status, 'rejected');
        assert.match(results[1].reason.message, /User rejected/);
        assert.equal(results[2].status, 'fulfilled');
        assert.equal(requests.length, 2, 'Only the 2 approved rows should call Google API');
    } finally {
        restore();
    }
});

test('getCssCandidateUrls checks same dir, ../css/, then parent dir in order', () => {
    const urls = gTools.getCssCandidateUrls('https://example.com/app/js/gTools.js');
    assert.deepEqual(urls, [
        'https://example.com/app/js/gTools.css',
        'https://example.com/app/css/gTools.css',
        'https://example.com/app/gTools.css'
    ]);
});
