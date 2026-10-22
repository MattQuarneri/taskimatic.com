import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../webcomp/task-item.js', import.meta.url), 'utf8');
const names = ['task', 'notes', 'prompts', 'associations', 'time'];
function createItem() {
    const tabs = names.map(name => ({ dataset: { compactTab: name }, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }));
    const panels = names.map(name => ({ dataset: { compactPanel: name } }));
    const classes = new Set();
    let TaskItem;
    vm.runInNewContext(source.slice(source.indexOf('class TaskItem')), {
        HTMLElement: class {
            attachShadow() {
                this.shadowRoot = {
                    querySelector: () => ({ classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); } } }),
                    querySelectorAll: selector => selector === '[data-compact-tab]' ? tabs : panels
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
