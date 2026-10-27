import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeTask } from '../js/task-model.js';
import { normalizeAssociations, normalizeWorkspaceSnapshot, planningAssociations } from '../js/task-planning-model.js';

const helper = fs.readFileSync(new URL('../js/file-associations.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const context = vm.createContext({ URL, guessMimeType: () => 'text/plain', openFloatingFileView: file => file, fileRepo: {put: async file => ({id: 'a'.repeat(64), name: file.name, mime: file.type, size: file.size})} });
vm.runInContext(helper, context);

test('file paths preserve their full length and ordinary associations keep their limits', () => {
    const value = '/Users/me/' + 'long-directory/'.repeat(20) + 'notes.md';
    assert.equal(normalizeAssociations([{type: 'file', value}])[0].value, value);
    assert.equal(normalizeAssociations([{type: 'project', value}])[0].value.length, 120);
});

test('attached bytes survive workspace export/import and roll up through all planning levels', async () => {
    const association = {type: 'file', value: 'notes.md', file: {
        name: 'notes.md', mime: 'text/markdown', size: 5, data: 'data:text/markdown;base64,IyBIaQ=='
    }};
    const workspace = normalizeWorkspaceSnapshot({
        tasks: [normalizeTask({id: 'task', text: 'Task', planId: 'plan', associations: [association]})],
        plans: [{id: 'plan', goalId: 'goal'}], goals: [{id: 'goal', wantId: 'want'}], wants: [{id: 'want'}]
    }, normalizeTask);
    const imported = normalizeWorkspaceSnapshot(JSON.parse(JSON.stringify(workspace)), normalizeTask);
    assert.deepEqual(imported.tasks[0].associations, [association]);
    for (const [kind, record] of [['plans', imported.plans[0]], ['goals', imported.goals[0]], ['wants', imported.wants[0]]]) {
        assert.deepEqual(planningAssociations(kind, record, imported), [association]);
    }
    assert.equal((await context.openFileAssociation(association)).url, association.file.data);
    assert.equal((await context.openFileAssociation(association)).path, '');
});

test('file descriptors open local paths, file URLs and HTTP URLs using the filename', async () => {
    for (const value of ['/Users/me/notes.md', 'file:///Users/me/notes.md', 'https://example.test/notes.md']) {
        const file = await context.openFileAssociation({type: 'file', value});
        assert.equal(file.name, 'notes.md');
        if (value.includes('://')) { assert.equal(file.path, ''); assert.equal(file.url, value); }
        else assert.equal(file.path, '/Users/me/notes.md');
    }
});

test('the local file picker stores an OPFS reference rather than embedded bytes', async () => {
    const association = await context.associationFromFile({name: 'hello.txt', type: 'text/plain', size: 2});
    assert.equal(association.type, 'file');
    assert.equal(association.file.id, 'a'.repeat(64));
    assert.equal(association.file.name, 'hello.txt');
    assert.equal(association.file.data, undefined);
    assert.match(association.value, /^filerepo:/);
    assert.equal(normalizeAssociations([association])[0].file.id, association.file.id);
});

test('file links accept any absolute URL protocol and reject bare paths or relative links', () => {
    for (const value of ['http://example.com/a', 'https://example.com/a', 'file:///Users/me/a', 'ftp://example.com/a', 'mailto:me@example.com', 'custom:resource']) assert.equal(context.validFileLink(value), true, value);
    for (const value of ['', 'notes.md', '/Users/me/notes.md', 'https://']) assert.equal(context.validFileLink(value), false, value);
});

test('the property dropdown includes file and its editor defaults to Link then switches to Local', async () => {
    const node = () => ({value: '', listeners: {}, children: [], dataset: {},
        addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); },
        async fire(type) { for (const handler of this.listeners[type] || []) await handler({preventDefault() {}}); },
        dispatchEvent(event) { for (const handler of this.listeners[event.type] || []) handler(event); },
        replaceChildren(...items) { this.children = items; }, append(item) { this.children.push(item); },
        setAttribute(name, value) { this[name] = value; },
        setCustomValidity(message) { this.error = message; }, reportValidity() { this.reported = true; },
        click() { this.clicked = true; }, focus() {}
    });
    context.document = {createElement: node};
    context.Event = class {constructor(type) {this.type = type;}};
    context.window = {alert(message) {throw new Error(message);}};
    const form = node(), type = node(), value = node(), property = node(), sources = node(), local = node(), submit = node();
    const linkButton = node(), localButton = node();
    linkButton.dataset.fileMode = 'link'; localButton.dataset.fileMode = 'local';
    sources.querySelectorAll = () => [linkButton, localButton];
    form.querySelector = selector => ({'.association-property-select': property, '.file-source': sources,
        '.association-local-file': local, '[type="submit"]': submit})[selector];
    const added = [];
    context.installFileAssociationEditor(form, type, value, ['project', 'domain'], association => added.push(association));
    assert.ok(property.children.some(option => option.value === 'file'));
    assert.equal(property.children.find(option => option.value === 'file').textContent, 'local file');
    property.value = 'file';
    await property.fire('change');
    assert.equal(form.dataset.fileAssociation, 'true');
    assert.equal(sources.hidden, false);
    assert.equal(linkButton['aria-checked'], 'true');
    assert.equal(local.hidden, true);
    value.value = 'missing-protocol.md';
    await form.fire('submit');
    assert.equal(added.length, 0);
    assert.match(value.error, /protocol/);
    value.value = 'file:///Users/me/notes.md';
    await form.fire('submit');
    assert.equal(added[0].value, 'file:///Users/me/notes.md');
    await localButton.fire('click');
    assert.equal(local.clicked, true);
    assert.equal(local.required, true);
    assert.equal(value.hidden, true);
    local.files = [{name: 'hello.md', type: 'text/markdown', size: 12}];
    await form.fire('submit');
    assert.equal(added[1].file.id, 'a'.repeat(64));
    assert.equal(added[1].file.data, undefined);
});

test('Markdown and JavaScript use JSONMD, with JavaScript kept inside an escaped code fence', () => {
    let FloatingFileView;
    const preview = {};
    const source = fs.readFileSync(new URL('../webcomp/floating-file-view.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replace(/^export \{[^}]*\};?$/gm, '').replace(/^export /gm, '');
    vm.runInNewContext(source, {
        HTMLElement: class {},
        customElements: { get() {}, define(name, constructor) { FloatingFileView = constructor; } },
        document: {createElement(tag) { preview.tag = tag; return {setAttribute() {}, set value(value) {preview.value = value;}}; }}
    });
    const body = {replaceChildren() {}, appendChild() {}};
    for (const [name, text] of [['notes.md', '# Hello'], ['code.js', 'const x = `safe`;\n```\n<script>alert(1)</script>']]) {
        FloatingFileView.prototype._populateText.call({_file: {name}, _renderMarkdown: true, _textCache: text}, body);
        assert.equal(preview.tag, 'json-md');
        assert.equal(preview.value, name.endsWith('.js') ? '````javascript\n' + text + '\n````' : text);
    }
});
