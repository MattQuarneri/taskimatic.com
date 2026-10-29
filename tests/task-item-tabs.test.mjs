import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../webcomp/task-item.js', import.meta.url), 'utf8');
const names = ['task', 'notes', 'prompts', 'associations', 'time'];
function createItem(mode = 'compact') {
    const tabNames = mode === 'compact' ? names : names.slice(1);
    const tabs = tabNames.map(name => ({ dataset: { [`${mode}Tab`]: name }, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }));
    const panels = tabNames.map(name => ({ dataset: { [`${mode}Panel`]: name } }));
    const classes = new Set();
    const handlers = {};
    const card = {
        classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); } },
        addEventListener(name, handler) { handlers[name] = handler; }
    };
    const text = { style: {}, scrollHeight: 30 };
    const pendingTimers = new Map();
    let timerId = 0;
    let TaskItem;
    vm.runInNewContext(source.slice(source.indexOf('class TaskItem')), {
        HTMLElement: class {
            attachShadow() {
                this.shadowRoot = {
                    querySelector: selector => selector === '.text' ? text : card,
                    querySelectorAll: selector => selector === `[data-${mode}-tab]` ? tabs : selector === `[data-${mode}-panel]` ? panels : []
                };
            }
            dispatchEvent(event) { this.lastEvent = event; }
        },
        window: { matchMedia: () => ({ matches: true }) },
        setTimeout(callback) { pendingTimers.set(++timerId, callback); return timerId; },
        clearTimeout(id) { pendingTimers.delete(id); },
        CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
        customElements: { define(name, component) { TaskItem = component; } }
    });
    const item = new TaskItem();
    item._task = { id: 'task-1' };
    return { item, tabs, panels, classes, text, handlers,
        flushTimers() { for (const callback of pendingTimers.values()) callback(); pendingTimers.clear(); }
    };
}

test('each compact tab collapses its panel and footer on repeat selection, then reopens', () => {
    for (const name of names) {
        const { item, tabs, panels, classes } = createItem();
        item.compactTab = name;
        assert.equal(panels.find(panel => !panel.hidden).dataset.compactPanel, name);
        item.selectCompactTab(name, true);
        assert.ok(panels.every(panel => panel.hidden));
        assert.ok(classes.has('compact-collapsed'));
        assert.equal(item.lastEvent.detail.tab, null);
        assert.ok(tabs.every(tab => tab.attributes['aria-selected'] === 'false'));
        assert.equal(tabs.filter(tab => tab.tabIndex === 0).length, 1);
        item.selectCompactTab(name, true);
        assert.equal(panels.find(panel => !panel.hidden).dataset.compactPanel, name);
        assert.ok(!classes.has('compact-collapsed'));
    }
});

test('switching tabs opens the new panel and keyboard selection does not collapse it', () => {
    const { item, panels } = createItem();
    item.selectCompactTab('task', true);
    item.selectCompactTab('notes', true);
    item.selectCompactTab('notes');
    assert.equal(panels.find(panel => !panel.hidden).dataset.compactPanel, 'notes');
    item.compactTab = null;
    item.updateCompactTabs();
    assert.ok(panels.every(panel => panel.hidden));
});

test('full-size tabs start collapsed with one keyboard focus target', () => {
    const { item, tabs, panels } = createItem('editor');
    item.updateEditorTabs();
    assert.ok(panels.every(panel => panel.hidden));
    assert.ok(tabs.every(tab => tab.attributes['aria-selected'] === 'false'));
    assert.equal(tabs.filter(tab => tab.tabIndex === 0).length, 1);
});

test('every full-size tab opens, collapses on repeat selection, and reopens', () => {
    for (const name of names.slice(1)) {
        const { item, tabs, panels } = createItem('editor');
        item.selectEditorTab(name, true);
        assert.equal(panels.find(panel => !panel.hidden).dataset.editorPanel, name);
        item.selectEditorTab(name, true);
        assert.equal(item.lastEvent.type, 'task-editor-tab-change');
        assert.equal(item.lastEvent.detail.tab, null);
        assert.ok(panels.every(panel => panel.hidden));
        assert.ok(tabs.every(tab => tab.attributes['aria-expanded'] === 'false'));
        assert.equal(tabs.find(tab => tab.tabIndex === 0).dataset.editorTab, name);
        item.selectEditorTab(name, true);
        assert.equal(panels.find(panel => !panel.hidden).dataset.editorPanel, name);
    }
});

test('full-size tab switches and synchronized state keep exactly one panel open', () => {
    const { item, panels } = createItem('editor');
    item.selectEditorTab('associations', true);
    item.selectEditorTab('time');
    item.selectEditorTab('time');
    assert.deepEqual(panels.filter(panel => !panel.hidden).map(panel => panel.dataset.editorPanel), ['time']);
    item.editorTab = null;
    item.updateEditorTabs();
    assert.ok(panels.every(panel => panel.hidden));
    item.editorTab = 'associations';
    assert.equal(panels.find(panel => !panel.hidden).dataset.editorPanel, 'associations');
});


test('idle cards reveal controls on tap or click without expanding on hover', () => {
    const { item, classes, text, handlers } = createItem();
    item.setExpanded(false);
    item.installExpansionHandlers();
    assert.ok(classes.has('shrunk'));
    assert.equal(text.readOnly, true);
    assert.equal(handlers.pointerenter, undefined);
    assert.equal(handlers.pointerleave, undefined);
    let prevented = false;
    handlers.pointerdown({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true, 'first tap prevents keyboard activation');
    assert.ok(!classes.has('shrunk'));
    assert.equal(text.readOnly, false);
    handlers.pointerdown({ preventDefault() { assert.fail('expanded controls must remain interactive'); } });
    item.setExpanded(false);
    handlers.click();
    assert.ok(!classes.has('shrunk'));
});

test('outside taps shrink cards, while taps inside preserve their open panel', () => {
    const { item, classes, panels } = createItem();
    item.compactTab = 'notes';
    item.setExpanded(true);
    item._onOutsidePointer({ composedPath: () => [item] });
    assert.equal(item._expanded, true);
    item._onOutsidePointer({ composedPath: () => [] });
    assert.ok(classes.has('shrunk'));
    item.setExpanded(true);
    assert.equal(panels.find(panel => !panel.hidden).dataset.compactPanel, 'notes');
});

test('keyboard focus expands cards and only shrinks after focus leaves the card', () => {
    const { item, handlers, text, flushTimers } = createItem();
    item.installExpansionHandlers();
    handlers.focusin();
    assert.equal(item._expanded, true);
    item.shadowRoot.activeElement = text;
    handlers.focusout();
    flushTimers();
    assert.equal(item._expanded, true);
    item.shadowRoot.activeElement = null;
    handlers.focusout();
    flushTimers();
    assert.equal(item._expanded, false);
});


test('either running timer keeps cards expanded through initial render and collapse attempts', () => {
    for (const activeTimers of [{ human: { startedAt: 1 } }, { agent: { startedAt: 1 } }, { human: { startedAt: 1 }, agent: { startedAt: 1 } }]) {
        const { item, classes, text, flushTimers } = createItem();
        item._task.activeTimers = activeTimers;
        item.setExpanded(false);
        assert.equal(item._expanded, true);
        assert.equal(classes.has('shrunk'), false);
        assert.equal(text.readOnly, false);
        item._onOutsidePointer({ composedPath: () => [] });
        assert.equal(item._expanded, true);
        item.scheduleShrink();
        flushTimers();
        assert.equal(item._expanded, true);

        item._task.activeTimers = { human: null, agent: null };
        item._onOutsidePointer({ composedPath: () => [] });
        assert.equal(item._expanded, false);
        assert.equal(classes.has('shrunk'), true);
    }
});
