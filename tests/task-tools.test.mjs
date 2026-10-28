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
        ready: Promise.resolve(), statusFilter: 'open', repository: { async put() {} },
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
