import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../webcomp/task-workspace.js', import.meta.url), 'utf8');
const methods = source.slice(source.indexOf('    isTodayLocked() {'), source.indexOf('    positionBrandHelp() {'));
const setter = source.slice(source.indexOf('    setLockInEnabled(enabled) {'), source.indexOf('    updateLockInPill() {'));

function workspace() {
    const nodes = new Map();
    const node = () => ({
        disabled: false, hidden: true, attributes: {}, classes: new Set(),
        classList: { toggle(name, on) { on ? this.owner.classes.add(name) : this.owner.classes.delete(name); } },
        setAttribute(name, value) { this.attributes[name] = value; },
        focus() {}
    });
    for (const selector of ['#today-close', '#today-lock', '#drawer-scrim', ...['today', 'associations', 'insights'].flatMap(name => [`#${name}-drawer`, `#${name}-tab`])]) {
        const element = node();
        element.classList.owner = element;
        nodes.set(selector, element);
    }
    const app = vm.runInNewContext('new (class {' + setter + methods + '})()', { t: key => key, localStorage: { setItem() {} } });
    Object.assign(app, { lockInEnabled: false, activeDrawer: null, tasks: [], querySelector: selector => nodes.get(selector), updateLockInPill() {} });
    return { app, nodes };
}

test('engaging Lock In opens Today without a running timer and blocks every drawer dismissal', () => {
    const { app, nodes } = workspace();
    app.setLockInEnabled(true);
    assert.equal(app.activeDrawer, 'today');
    assert.equal(nodes.get('#today-close').disabled, true);
    assert.equal(nodes.get('#today-lock').hidden, false);
    app.closeDrawers();
    assert.equal(app.activeDrawer, 'today');
    app.toggleDrawer('today');
    assert.equal(app.activeDrawer, 'today');
    assert.equal(app.openDrawer('insights'), false);
    assert.equal(app.activeDrawer, 'today');
});

test('turning Lock In off allows closing Today even when a human timer is running', () => {
    const { app, nodes } = workspace();
    app.tasks = [{ today: true, activeTimers: { human: '2026-10-23T12:00:00Z' } }];
    app.setLockInEnabled(true);
    app.setLockInEnabled(false);
    assert.equal(nodes.get('#today-close').disabled, false);
    assert.equal(nodes.get('#today-lock').hidden, true);
    app.closeDrawers();
    assert.equal(app.activeDrawer, null);
    app.syncTodayDrawer();
    assert.equal(app.activeDrawer, null);
});
