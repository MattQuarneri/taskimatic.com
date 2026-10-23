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
    let TaskItem;
    vm.runInNewContext(source.slice(source.indexOf('class TaskItem')), {
        HTMLElement: class {
            attachShadow() {
                this.shadowRoot = {
                    querySelector: () => ({ classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); } } }),
                    querySelectorAll: selector => selector === `[data-${mode}-tab]` ? tabs : selector === `[data-${mode}-panel]` ? panels : []
                };
            }
            dispatchEvent(event) { this.lastEvent = event; }
        },
        window: { matchMedia: () => ({ matches: true }) },
        CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
        customElements: { define(name, component) { TaskItem = component; } }
    });
    const item = new TaskItem();
    item._task = { id: 'task-1' };
    return { item, tabs, panels, classes };
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
