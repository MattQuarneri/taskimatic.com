import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createTaskToolRegistry } from '../js/task-tools.js';
import { normalizeTask } from '../js/task-model.js';
import { normalizeAssociations, normalizePlanningRecord, planningAssociations } from '../js/task-planning-model.js';

// Exercise the actual workspace actions with in-memory persistence and rendering.
const source = await fs.readFile(new URL('../webcomp/task-workspace.js', import.meta.url), 'utf8');
const Workspace = vm.runInNewContext(source.slice(source.indexOf('class TaskWorkspace'), source.indexOf('export {')) + '\nTaskWorkspace', {
    HTMLElement: class {}, normalizeAssociations, normalizePlanningRecord, normalizeTask, planningAssociations,
    uid: () => "session-test", formatDuration: String, uiLabel: String,
    cloneValue: structuredClone, nowISO: () => new Date().toISOString(), cleanString: (v, max) => String(v ?? '').trim().slice(0, max),
    invalidateDurationCache() {}, TIMER_ACTORS: ['human', 'agent'], t: key => key
});
function fixture() {
    const w = Object.create(Workspace.prototype);
    Object.assign(w, {
        tasks: [], plans: [], goals: [], wants: [], agents: [], pendingPlanningCreates: new Map(),
        ready: Promise.resolve(), statusFilter: 'open', repository: { async put() {}, async putMany() {} },
        renderAll() {}, renderPlanning() {}, emitChange() {}, querySelectorAll: () => [],
        toast() {}, isProtectPlanEngaged: () => false,
        tools: null
    });
    w.tools = createTaskToolRegistry(async () => w);
    return w;
}

test('tools create and edit a linked want/goal/plan/task hierarchy using workspace actions', async () => {
    const w = fixture();
    const call = w.tools.call;
    const want = await call('createWant', { input: { text: 'Ship the app' } });
    const goal = await call('createChild', { kind: 'wants', id: want.id, input: { text: 'First release' } });
    const plan = await call('createChild', { kind: 'goals', id: goal.id, input: { text: 'Build tools' } });
    const task = await call('createChild', { kind: 'plans', id: plan.id, input: { text: 'Write docs' } });
    assert.equal(goal.wantId, want.id);
    assert.equal(plan.goalId, goal.id);
    assert.equal(task.planId, plan.id);
    await call('updatePlan', { id: plan.id, patch: { aiThinking: 'Document signatures' } });
    assert.equal(w.plans[0].aiThinking, 'Document signatures');
    await assert.rejects(call('updatePlan', { id: plan.id, patch: { goalId: 'missing' } }));
    await assert.rejects(call('createChild', { kind: 'plans', id: 'missing', input: { text: 'Oops' } }), /Parent not found/);
});

test('association tools normalize, deduplicate and remove own associations across entities', async () => {
    const w = fixture();
    for (const entity of ['Task', 'Plan', 'Goal', 'Want']) {
        const record = await w.tools.call(`create${entity}`, { input: { text: entity } });
        for (const type of ['Project', 'project']) await w.tools.call(`add${entity}Association`, { id: record.id, association: { type, value: 'Taskimatic' } });
        const removed = await w.tools.call(`remove${entity}Association`, { id: record.id, association: { type: 'PROJECT', value: 'TASKIMATIC' } });
        assert.deepEqual(removed.associations, []);
    }
});

test('invalid arguments and unknown tools reject before workspace access', async () => {
    const tools = createTaskToolRegistry(() => { throw Error('workspace accessed'); });
    for (const [name, args] of [
        ['missing', {}], ['updateTask', { id: 'a', patch: { typo: true } }],
        ['createTask', { input: {} }], ['startTimer', { id: 'a', actor: 'robot' }],
        ['setTaskPriority', { id: 'a', priority: 1.5 }], ['listTasks', null],
        ['updateGoal', { id: 'a', patch: { achieved: 'yes' } }]
    ]) await assert.rejects(tools.call(name, args), error => !error.message.includes('workspace accessed'));
});

test('LoadTools entries execute with object arguments; descriptors are serializable and isolated', async () => {
    const w = fixture();
    const entries = w.tools.forLoadTools();
    assert.equal(new Set(entries.map(tool => tool.name)).size, entries.length);
    const tool = entries.find(tool => tool.name === 'createWant');
    const result = await tool.execute({ input: { text: 'Test harness' } });
    assert.equal(result.text, 'Test harness');
    tool.parameters.properties.input.properties.text.type = 'number';
    assert.equal(w.tools.list().find(tool => tool.name === 'createWant').parameters.properties.input.properties.text.type, 'string');
    assert.doesNotThrow(() => JSON.stringify(w.tools.list()));
    assert.ok(w.tools.list().find(tool => tool.name === 'deleteTask').annotations.destructive);
});

test('additional app tools can be registered with duplicate protection', async () => {
    const w = fixture();
    const definition = { name: 'echo', description: 'Echo text', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } };
    w.tools.register(definition, args => args.text);
    assert.equal(await w.tools.call('echo', { text: 'hello' }), 'hello');
    assert.throws(() => w.tools.register(definition, () => {}), /already registered/);
});

test('timers, session edits and priorities preserve workspace behavior', async () => {
    const w = fixture();
    const first = await w.tools.call('createTask', { input: { text: 'First' } });
    const second = await w.tools.call('createTask', { input: { text: 'Second' } });
    await w.tools.call('setTaskPriority', { id: second.id, priority: 1 });
    assert.equal(w.tasks.find(task => task.id === second.id).priority, 1);
    await w.tools.call('startTimer', { id: first.id });
    await w.tools.call('startTimer', { id: second.id });
    assert.equal(w.tasks[0].activeTimers.human, null);
    assert.equal(w.tasks[0].sessions.length, 1);
    const sessionId = w.tasks[0].sessions[0].id;
    await w.tools.call('updateSession', { id: first.id, sessionId, patch: { startedAt: '2026-10-27T12:00:00Z', endedAt: '2026-10-27T12:01:00Z' } });
    assert.equal(w.tasks[0].sessions[0].durationSeconds, 60);
    await w.tools.call('deleteSession', { id: first.id, sessionId });
    assert.equal(w.tasks[0].sessions.length, 0);
    await w.tools.call('stopTimer', { id: second.id });
    assert.equal(w.tasks[1].activeTimers.human, null);
});

test('list tools expose derived planning associations and quiet updates preserve editor context', async () => {
    const w = fixture();
    const plan = await w.tools.call('createPlan', { input: { text: 'Plan' } });
    await w.tools.call('createTask', { input: { text: 'Child', planId: plan.id, associations: [{ type: 'project', value: 'Tools' }] } });
    const plans = await w.tools.call('listPlans', { query: { association: { type: 'project', value: 'tools' } } });
    assert.equal(plans.length, 1);
    assert.equal(plans[0].effectiveAssociations[0].value, 'Tools');
    let received;
    w.updateTask = (id, patch, context) => { received = context; return { id, ...patch }; };
    const source = {};
    await w.tools.call('updateTask', { id: 'task', patch: { notes: 'typing' } }, { quiet: true, source });
    assert.equal(received.source, source);
    assert.equal(received.quiet, true);
});

test('UI and independent tool registries serialize patches and incremental associations against current state', async () => {
    const w = fixture();
    const task = await w.createTask({ text: 'Original' });
    const external = createTaskToolRegistry(async () => w);
    await Promise.all([
        w.updateTask(task.id, { notes: 'Human edit' }),
        external.call('updateTask', { id: task.id, patch: { text: 'Agent edit' } }),
        w.addAssociation(task.id, { type: 'project', value: 'One' }),
        external.call('addTaskAssociation', { id: task.id, association: { type: 'client', value: 'Two' } })
    ]);
    assert.equal(w.tasks[0].text, 'Agent edit');
    assert.equal(w.tasks[0].notes, 'Human edit');
    assert.equal(w.tasks[0].associations.length, 2);
    const plan = await w.createPlanning('plans', { text: 'Approach' });
    await Promise.all([
        w.updatePlanning('plans', plan.id, { myThinking: 'Human reasoning' }),
        external.call('updatePlan', { id: plan.id, patch: { aiThinking: 'Proposal' } }),
        w.addEntityAssociation('plans', plan.id, { type: 'project', value: 'One' }),
        external.call('addPlanAssociation', { id: plan.id, association: { type: 'client', value: 'Two' } })
    ]);
    assert.equal(w.plans[0].myThinking, 'Human reasoning');
    assert.equal(w.plans[0].aiThinking, 'Proposal');
    assert.equal(w.plans[0].associations.length, 2);
});

test('invalid completion validates all fields before stopping timers or writing storage', async () => {
    const w = fixture();
    const task = await w.createTask({ text: 'Working' });
    await w.startTimer(task.id);
    const before = structuredClone(w.tasks);
    let writes = 0;
    w.repository.put = w.repository.putMany = async () => { writes++; };
    await assert.rejects(w.tools.call('updateTask', { id: task.id, patch: { status: 'done', planId: 'missing' } }));
    assert.deepEqual(structuredClone(w.tasks), before);
    assert.equal(writes, 0);
    // Failure must not poison the mutation queue.
    await w.updateTask(task.id, { notes: 'Corrected request' });
    assert.equal(w.tasks[0].notes, 'Corrected request');
});

test('failed timer and session writes preserve the last published task state', async () => {
    const w = fixture();
    const task = await w.createTask({ text: 'Working' });
    const save = w.repository.put;
    const fail = async () => { throw Error('disk full'); };
    async function unchanged(operation) {
        const before = structuredClone(w.tasks);
        w.repository.put = fail;
        await assert.rejects(operation(), /disk full/);
        assert.deepEqual(structuredClone(w.tasks), before);
        w.repository.put = save;
    }
    await unchanged(() => w.startTimer(task.id));
    await w.startTimer(task.id);
    await unchanged(() => w.stopTimer(task.id));
    await w.stopTimer(task.id);
    const sessionId = w.tasks[0].sessions[0].id;
    await unchanged(() => w.updateSession(task.id, sessionId, { startedAt: '2026-10-27T12:00:00Z', endedAt: '2026-10-27T12:01:00Z' }));
    await unchanged(() => w.deleteSession(task.id, sessionId));
});

test('timer switching and completion commit related records in one batch before publication', async () => {
    const w = fixture();
    const first = await w.createTask({ text: 'First' });
    const second = await w.createTask({ text: 'Second' });
    await w.startTimer(first.id);
    const before = structuredClone(w.tasks);
    let batch;
    w.repository.putMany = async records => { batch = records; throw Error('batch failed'); };
    await assert.rejects(w.startTimer(second.id), /batch failed/);
    assert.equal(batch.length, 2);
    assert.deepEqual(structuredClone(w.tasks), before);
    await assert.rejects(w.updateTask(first.id, { status: 'done' }), /batch failed/);
    assert.deepEqual(structuredClone(w.tasks), before);
    w.repository.putMany = async records => { batch = structuredClone(records); };
    await w.startTimer(second.id);
    assert.equal(batch.find(record => record.id === first.id).activeTimers.human, null);
    assert.ok(batch.find(record => record.id === second.id).activeTimers.human);
    assert.equal(w.tasks.filter(record => record.activeTimers.human).length, 1);
});

test('queued child creation completes before parent deletion and the child is unlinked', async () => {
    const w = fixture();
    w.repository.replaceWorkspace = async () => {};
    const plan = await w.createPlanning('plans', { text: 'Plan' });
    const [task] = await Promise.all([
        w.createPlanningChild('plans', plan.id, { text: 'Child' }),
        w.deletePlanning('plans', plan.id)
    ]);
    assert.equal(w.tasks.find(record => record.id === task.id).planId, null);
    assert.equal(w.plans.length, 0);
});

test('read tools wait for queued optimistic planning writes and never report a failed draft as saved', async () => {
    const w = fixture();
    let rejectSave;
    const pending = new Promise((resolve, reject) => { rejectSave = reject; });
    w.repository.put = () => pending;
    const create = w.createPlanning('plans', { text: 'Pending draft' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(w.plans.length, 1, 'UI may show an optimistic card');
    let readCompleted = false;
    const read = w.tools.call('listPlans').then(records => { readCompleted = true; return records; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(readCompleted, false);
    rejectSave(Error('save failed'));
    await assert.rejects(create, /save failed/);
    assert.deepEqual(await read, []);
});
