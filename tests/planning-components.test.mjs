import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { COMMON_PROPERTIES, canonicalType, parseQuickTask, normalizeTask } from '../js/task-model.js';
import { normalizePlanningRecord, normalizeWorkspaceSnapshot, validateWorkspaceLinks, planningAssociations } from '../js/task-planning-model.js';
import { WorkspaceLiveModel } from '../js/workspace-live-model.js';
import { t, escapeHTML, uiLabel } from './i18n-test-context.mjs';

class Element {
    constructor() { this.dataset = {}; this.listeners = {}; this.children = []; this.value = ''; this.style = {}; this.scrollHeight = 30; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    dispatch(name) { this.listeners[name]?.({currentTarget: this, preventDefault() {}}); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = [...children]; }
    setAttribute(name, value) { this[name] = value; }
    focus() {}
    click() { this.dispatch('click'); }
}
class Shadow {
    set innerHTML(html) {
        this.html = html;
        this.nodes = [...html.matchAll(/<(article|input|textarea|select|button|div|span|form|datalist|h3)\b([^>]*)>/g)].map(([, tag, attrs]) => {
            const node = new Element();
            node.tag = tag;
            node.attrs = Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
            for (const [key, value] of Object.entries(node.attrs)) {
                if (key.startsWith('data-')) node.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
            }
            return node;
        });
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
        return this.nodes.filter(node => {
            if (selector.startsWith('.')) return (node.attrs.class || '').split(' ').includes(selector.slice(1));
            if (selector.startsWith('#')) return node.attrs.id === selector.slice(1);
            const [, key, value] = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/) || [];
            return key && key in node.attrs && (value === undefined || node.attrs[key] === value);
        });
    }
}
const registry = new Map();
const context = vm.createContext({
    COMMON_PROPERTIES, canonicalType, parseQuickTask, cloneValue: structuredClone, t, escapeHTML, uiLabel,
    setTimeout, clearTimeout,
    HTMLElement: class extends Element {
        attachShadow() { this.shadowRoot = new Shadow(); }
        dispatchEvent(event) { this.lastEvent = event; }
    },
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    document: {createElement: () => new Element()},
    customElements: {define(name, component) {registry.set(name, component);}}
});
for (const name of ['planning', 'plan', 'goal', 'want']) {
    const source = fs.readFileSync(new URL(`../webcomp/${name}-item.js`, import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
    vm.runInContext(source, context);
}
function item(kind, input = {}, children = []) {
    const component = new (registry.get(`${kind.slice(0, -1)}-item`))();
    const record = normalizePlanningRecord(kind, {id: kind, text: 'Example', ...input});
    component.setData({record, parents: [{id: 'want', text: 'Aspiration'}], goalParents: [{id: 'goal', text: 'Outcome'}],
        children, associations: [], catalog: {}});
    return component;
}

test('each component renders and edits only its own fields without requiring a kind argument', () => {
    for (const [kind, present, absent] of [
        ['plans', '.my-thinking', '.successCriteria'], ['goals', '.successCriteria', '.my-thinking'], ['wants', '.notes', '.targetDate']
    ]) {
        const component = item(kind);
        assert.equal(component.kind, kind);
        assert.ok(component.shadowRoot.querySelector(present));
        assert.equal(component.shadowRoot.querySelector(absent), null);
        const title = component.shadowRoot.querySelector('.text');
        title.value = 'Revised';
        title.dispatch('blur');
        assert.equal(component.lastEvent.type, 'planning-update');
        assert.equal(component.lastEvent.detail.patch.text, 'Revised');
        assert.equal(component.lastEvent.detail.kind, kind);
    }
});

test('goals emit achievement updates and plans navigate to their selected goal', () => {
    const goal = item('goals', {achieved: true, targetDate: '2026-12-01'});
    const checkbox = goal.shadowRoot.querySelector('.achieved');
    assert.equal(checkbox.checked, true);
    assert.equal(goal.shadowRoot.querySelector('.targetDate').value, '2026-12-01');
    checkbox.checked = false;
    checkbox.dispatch('change');
    assert.equal(goal.lastEvent.detail.patch.achieved, false);
    const plan = item('plans', {goalId: 'goal'});
    plan.shadowRoot.querySelector('.open-goal').click();
    assert.equal(plan.lastEvent.detail.targetKind, 'goals');
    assert.equal(plan.lastEvent.detail.targetId, 'goal');
});

test('plan thinking tabs preserve selection and whitespace when editing', () => {
    const plan = item('plans');
    plan.shadowRoot.querySelector('[data-planning-tab="aiThinking"]').click();
    assert.equal(plan.lastEvent.detail.tab, 'aiThinking');
    assert.equal(plan.shadowRoot.querySelector('[data-planning-panel="myThinking"]').hidden, true);
    const editor = plan.shadowRoot.querySelector('.ai-thinking');
    editor.value = '  Keep this formatting\n';
    editor.dispatch('blur');
    assert.equal(plan.lastEvent.detail.patch.aiThinking, editor.value);
});

test('wants navigate to both new goals and existing directly linked plans', () => {
    const want = item('wants', {}, [{id: 'goal', text: 'Outcome', targetKind: 'goals'}, {id: 'plan', text: 'Legacy approach', targetKind: 'plans'}]);
    const buttons = want.shadowRoot.querySelector('.children').children;
    buttons[0].click();
    assert.equal(want.lastEvent.detail.targetKind, 'goals');
    buttons[1].click();
    assert.equal(want.lastEvent.detail.targetKind, 'plans');
    assert.equal(want.shadowRoot.querySelector('.parent'), null);
});

test('goal links and task associations survive export normalization and roll up to wants', () => {
    const snapshot = normalizeWorkspaceSnapshot({
        wants: [{id: 'want', text: 'Get fit'}],
        goals: [{id: 'goal', text: 'Run 5K', wantId: 'want', successCriteria: 'Without stopping', targetDate: '2026-12-01', achieved: true}],
        plans: [{id: 'plan', text: 'Training', goalId: 'goal'}],
        tasks: [{id: 'task', text: 'First run', planId: 'plan', associations: [{type: 'project', value: 'Fitness'}]}]
    }, normalizeTask);
    validateWorkspaceLinks(snapshot);
    assert.equal(snapshot.goals[0].successCriteria, 'Without stopping');
    assert.equal(snapshot.goals[0].achieved, true);
    assert.deepEqual(planningAssociations('wants', snapshot.wants[0], snapshot), [{type: 'project', value: 'Fitness'}]);
    assert.throws(() => validateWorkspaceLinks({...snapshot, goals: []}), /Goal not found/);
    assert.equal(normalizePlanningRecord('goals', {targetDate: '2026-02-30'}).targetDate, null);
    assert.deepEqual(normalizeWorkspaceSnapshot({tasks: []}, normalizeTask).goals, []);
});


test('cards subscribe to the same revision and update parents, children, and external edits in place', () => {
    const model = new WorkspaceLiveModel();
    const snapshot = normalizeWorkspaceSnapshot({
        wants: [{id: 'wants', text: 'Explore'}],
        goals: [{id: 'goals', text: 'First outcome', wantId: 'wants'}],
        plans: [{id: 'plans', text: 'First approach', goalId: 'goals'}]
    }, normalizeTask);
    model.replace(snapshot);
    const plan = item('plans', snapshot.plans[0]);
    const goal = item('goals', snapshot.goals[0]);
    const want = item('wants', snapshot.wants[0]);
    for (const component of [plan, goal, want]) component.model = model;
    const title = goal.shadowRoot.querySelector('.text');
    snapshot.goals[0].text = 'Revised outcome';
    snapshot.plans.push(normalizePlanningRecord('plans', {id: 'second', text: 'Another approach', goalId: 'goals'}));
    model.replace(snapshot);
    assert.equal(goal.shadowRoot.querySelector('.text'), title);
    assert.equal(title.value, 'Revised outcome');
    assert.equal(goal.shadowRoot.querySelector('.children').children.length, 2);
    assert.equal(want.shadowRoot.querySelector('.children').children[0].textContent, 'Revised outcome');
    assert.equal(plan.shadowRoot.querySelector('.goal-parent').children[1].text, 'Revised outcome');
    goal.disconnectedCallback();
    snapshot.goals[0].text = 'While disconnected';
    model.replace(snapshot);
    assert.equal(title.value, 'Revised outcome');
    goal.connectedCallback();
    assert.equal(title.value, 'While disconnected');
    for (const component of [plan, goal, want]) component.disconnectedCallback();
});

test('a live update preserves an unsaved focused editor and model rebinding unsubscribes the old object', () => {
    const first = new WorkspaceLiveModel();
    const second = new WorkspaceLiveModel();
    const snapshot = normalizeWorkspaceSnapshot({goals: [{id: 'goals', text: 'Original'}]}, normalizeTask);
    first.replace(snapshot);
    second.replace(snapshot);
    const goal = item('goals');
    goal.model = first;
    const editor = goal.shadowRoot.querySelector('.text');
    goal.shadowRoot.activeElement = editor;
    editor.value = 'Draft in progress';
    snapshot.goals[0].text = 'External edit';
    first.replace(snapshot);
    assert.equal(editor.value, 'Draft in progress');
    goal.shadowRoot.activeElement = null;
    goal.model = second;
    assert.equal(editor.value, 'Original');
    snapshot.goals[0].text = 'No longer subscribed';
    first.replace(snapshot);
    assert.equal(editor.value, 'Original');
    goal.disconnectedCallback();
});


test('planning cards start collapsed and each tab toggles its details independently', () => {
    for (const kind of ['plans', 'goals', 'wants']) {
        const component = item(kind);
        const panels = component.shadowRoot.querySelectorAll('[data-planning-panel]');
        const tabs = component.shadowRoot.querySelectorAll('[data-planning-tab]');
        assert.ok(panels.every(panel => panel.hidden));
        assert.equal(tabs.filter(tab => tab.tabIndex === 0).length, 1);
        for (const tab of tabs) {
            tab.click();
            assert.equal(panels.filter(panel => !panel.hidden).length, 1);
            assert.equal(panels.find(panel => !panel.hidden).dataset.planningPanel, tab.dataset.planningTab);
            tab.click();
            assert.ok(panels.every(panel => panel.hidden));
            assert.equal(component.lastEvent.detail.tab, null);
            assert.equal(tab.tabIndex, 0);
        }
    }
});

test('linked-item tabs use capitalized labels for Tasks, Plans, and Goals', () => {
    for (const [kind, label] of [['plans', 'Tasks'], ['goals', 'Plans'], ['wants', 'Goals']]) {
        const component = item(kind);
        assert.equal(component.tabs.find(tab => tab.id === 'children').label, label);
    }
});

test('planning tabs support keyboard navigation and keep selection through refresh', () => {
    const component = item('plans');
    const tabs = component.shadowRoot.querySelectorAll('[data-planning-tab]');
    tabs[0].listeners.keydown({key: 'End', preventDefault() {}});
    assert.equal(component.lastEvent.detail.tab, 'children');
    const record = structuredClone(component._record);
    component.setData({record});
    assert.equal(component.shadowRoot.querySelector('[data-planning-panel="children"]').hidden, false);
    component.selectTab('children', true);
    component.setData({record});
    assert.ok(component.shadowRoot.querySelectorAll('[data-planning-panel]').every(panel => panel.hidden));
});
