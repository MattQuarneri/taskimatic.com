import test from 'node:test';
import assert from 'node:assert/strict';
import { msTools } from '../js/msTools.js';
import { createTaskToolRegistry } from '../js/task-tools.js';

function withMockMsBrowser({ token = 'ms-test-token' } = {}) {
    const prev = { indexedDB: globalThis.indexedDB, fetch: globalThis.fetch };
    const requests = [];
    const storeData = new Map([
        ['ms_graph_token', { id: 'ms_graph_token', token }],
        ['ms_graph_client_id', { id: 'ms_graph_client_id', clientId: 'ms-client-id' }]
    ]);

    globalThis.indexedDB = {
        open() {
            const req = {};
            queueMicrotask(() => {
                req.result = {
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
                req.onsuccess?.();
            });
            return req;
        }
    };

    globalThis.fetch = async (url, options = {}) => {
        requests.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
        if (url.includes('/calendarView')) {
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    value: [{
                        id: 'ms-ev-1',
                        subject: 'Teams Sync',
                        bodyPreview: 'Weekly sync',
                        start: { dateTime: '2026-11-14T17:00:00', timeZone: 'UTC' },
                        end: { dateTime: '2026-11-14T18:00:00', timeZone: 'UTC' },
                        categories: ['9'],
                        webLink: 'https://outlook.office.com/calendar/item/ms-ev-1'
                    }]
                })
            };
        }
        if (url.includes('/todo/lists/list-1/tasks') && (options.method || 'GET') === 'GET') {
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    value: [
                        { id: 'mt-1', title: 'Review Q4 Budget' },
                        { id: 'mt-2', title: 'Groceries' }
                    ]
                })
            };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'ms-created-1', subject: 'Created' }) };
    };

    return { requests, restore: () => Object.assign(globalThis, prev) };
}

test('msTools normalizes Microsoft Graph calendar events for Calendar.connect(msTools)', async () => {
    const { requests, restore } = withMockMsBrowser();
    try {
        const events = await msTools.calendar.getDayEvents('2026-11-14');
        assert.equal(events.length, 1);
        assert.equal(events[0].summary, 'Teams Sync');
        assert.equal(events[0].colorId, '9');
        assert.equal(events[0].start.dateTime, '2026-11-14T17:00:00Z');
        assert.ok(requests[0].url.includes('/me/calendar/calendarView'));
    } finally {
        restore();
    }
});

test('msTools registers with Taskimatic, searches To Do tasks, and gates writes behind approval', async () => {
    const { requests, restore } = withMockMsBrowser();
    let allow = false;
    try {
        const registry = createTaskToolRegistry(async () => ({}));
        const tools = msTools.registerWith(registry, { confirm: async () => allow });
        assert.equal(tools.length, 21);

        const found = await registry.call('ms_tasks_find', { query: 'q4 budget', taskListId: 'list-1' });
        assert.deepEqual(found.map((t) => t.id), ['mt-1']);

        await assert.rejects(
            registry.call('ms_tasks_create', { title: 'Blocked', taskListId: 'list-1' }),
            /User rejected/
        );
        assert.equal(requests.length, 1);

        allow = true;
        const created = await registry.call('ms_tasks_create', { title: 'Approved', taskListId: 'list-1' });
        assert.equal(created.id, 'ms-created-1');
        assert.equal(requests[1].method, 'POST');
        assert.ok(requests[1].url.endsWith('/me/todo/lists/list-1/tasks'));
    } finally {
        restore();
    }
});
