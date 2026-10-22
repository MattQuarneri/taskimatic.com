import { COMMON_PROPERTIES, cloneValue, canonicalType, parseQuickTask } from '../js/task-model.js';
export class PlanningItem extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._saveTimers = {};
        this._confirmTimer = null;
        this._model = null;
        this._unsubscribe = null;
    }

    setData({ kind, record, parents = [], children = [], associations = record.associations || [], catalog = {}, goalParents = [], thinkingTab = 'myThinking' }) {
        this.kind = this.constructor.kind || kind;
        this._thinkingTab = thinkingTab === 'aiThinking' ? 'aiThinking' : 'myThinking';
        this._record = cloneValue(record);
        this.dataset.recordId = record.id;
        this.render(parents, children, associations, catalog, goalParents);
    }

    get model() { return this._model; }
    set model(next) {
        this._unsubscribe?.();
        this._unsubscribe = null;
        this._model = next;
        this.subscribeToModel();
        this.refreshFromModel();
    }

    connectedCallback() {
        this.subscribeToModel();
        this.refreshFromModel();
    }

    subscribeToModel() {
        if (!this._model || this._unsubscribe) return;
        this._unsubscribe = this._model.subscribe(() => this.refreshFromModel());
    }

    refreshFromModel() {
        if (!this._record) return;
        const data = this._model?.planningData(this.kind, this._record.id);
        if (!data) return;
        const before = this._record;
        this._record = cloneValue(data.record);
        for (const field of this.editableFields) {
            if (before[field] === data.record[field]) continue;
            const input = this.shadowRoot.querySelector(this.fieldSelector(field));
            if (this.shadowRoot.activeElement !== input && !this._saveTimers[field]) input.value = data.record[field] ?? '';
        }
        this.refreshRelationships(data.parents, data.goalParents);
        const achieved = this.shadowRoot.querySelector('.achieved');
        if (achieved) achieved.checked = data.record.achieved;
        this.renderAssociationChips(data.associations);
        this.renderChildren(data.children);
        this.shadowRoot.querySelector('.children-heading').textContent = `${t(this.childrenTitleKey)} · ${data.children.length}`;
        this.refreshCatalog(data.catalog);
    }

    fieldSelector(field) {
        return { myThinking: '.my-thinking', aiThinking: '.ai-thinking' }[field] || `.${field}`;
    }

    refreshRelationships(parents, goalParents) {
        for (const [selector, records, field, emptyKey] of [
            ['.parent', parents, 'wantId', 'error.messages.noWant'],
            ['.goal-parent', goalParents, 'goalId', 'ui.text.noGoal']
        ]) {
            const select = this.shadowRoot.querySelector(selector);
            if (!select) continue;
            select.replaceChildren(new Option(t(emptyKey), ''), ...records.map(record => new Option(record.text, record.id)));
            select.value = this._record[field] || '';
        }
        const want = this.shadowRoot.querySelector('.open-parent');
        if (want) want.hidden = !this._record.wantId;
        const goal = this.shadowRoot.querySelector('.open-goal');
        if (goal) goal.hidden = !this._record.goalId;
    }

    refreshCatalog(catalog) {
        this._catalog = catalog;
        const types = this.shadowRoot.querySelector('#planning-types');
        types.replaceChildren(...[...new Set([...COMMON_PROPERTIES, ...Object.keys(catalog)])].map(property => new Option(property, property)));
    }

    get untrimmedFields() { return []; }

    renderRelationships() { return ''; }
    bindDetails() {}

    renderWantParent() {
        return `<label class="parent-label">${escapeHTML(t('ui.text.wantOptional'))}<span class="parent-row"><select class="parent" aria-label="${escapeHTML(t('ui.text.parentWant'))}"></select><button class="open-parent" type="button" ${this._record.wantId ? '' : 'hidden'}>${escapeHTML(t('ui.text.openWant'))}</button></span></label>`;
    }

    bindWantParent(parents) {
        const parent = this.shadowRoot.querySelector('.parent');
        if (!parent) return;
        parent.append(new Option(t('error.messages.noWant'), ''));
        for (const record of parents) parent.append(new Option(record.text, record.id));
        parent.value = this._record.wantId || '';
        parent.addEventListener('change', () => this.emit('planning-update', { patch: { wantId: parent.value || null } }));
        this.shadowRoot.querySelector('.open-parent').addEventListener('click', () => this.emit('planning-navigate', { targetKind: 'wants', targetId: this._record.wantId }));
    }

    disconnectedCallback() {
        this._unsubscribe?.();
        this._unsubscribe = null;
        Object.values(this._saveTimers).forEach(clearTimeout);
        clearTimeout(this._confirmTimer);
    }

    emit(name, detail = {}) {
        this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail: { kind: this.kind, id: this._record.id, ...detail } }));
    }

    render(parents, children, associations, catalog, goalParents) {
        const singular = this.kind.slice(0, -1);
        const childKind = this.childKind;
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; min-width: 0; }
                * { box-sizing: border-box; }
                [hidden] { display: none !important; }
                article { padding: 16px; border: 1px solid var(--ink, #18242b); border-radius: 14px; background: var(--panel, #fffdf7); box-shadow: 3px 3px 0 rgba(24,36,43,.11); }
                :host([attention]) article { outline: 3px solid var(--blue, #315f91); }
                button, input, select, textarea { font: inherit; color: inherit; }
                button { min-height: 32px; height: auto; border: 1px solid var(--line, #cfc8b8); border-radius: 7px; padding: 4px 10px; background: var(--paper, #f3efe4); cursor: pointer; font-size: var(--font-md, 12px); }
                button:hover { border-color: var(--ink, #18242b); }
                button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 3px solid rgba(49,95,145,.28); outline-offset: 2px; }
                label { display: grid; gap: 5px; margin-bottom: 12px; color: var(--muted, #697177); font-size: var(--font-sm, 11px); }
                textarea, input, select { width: 100%; min-width: 0; min-height: 34px; border: 1px solid var(--line, #cfc8b8); border-radius: 8px; background: var(--panel, #fffdf7); padding: 8px; color: var(--ink, #18242b); font-size: var(--font-base, 13px); }
                .text { border: 0; padding: 0; font-size: var(--font-2xl, 17px); font-weight: 750; resize: vertical; }
                .thinking-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
                .thinking-tabs button { flex: 1; }
                .thinking-tabs button[aria-selected="true"] { background: var(--ink, #18242b); color: white; }
                button[role="tab"]:hover { background: var(--panel, #fffdf7); color: var(--ink, #18242b); }
                .notes, .my-thinking, .ai-thinking { min-height: 110px; resize: vertical; line-height: 1.5; font-size: var(--font-base, 13px); }
                .achieved-label { display: flex; align-items: center; gap: 8px; }
                .achieved { width: auto; min-height: 20px; }
                .parent-row { display: flex; gap: 8px; }
                .parent-row select { flex: 1; }
                .chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 10px 0; }
                .chip { display: inline-flex; align-items: center; gap: 5px; min-height: 22px; height: auto; border: 1px solid var(--line, #cfc8b8); border-radius: 999px; padding: 4px 8px; color: var(--blue, #315f91); background: rgba(49,95,145,.06); font-size: var(--font-sm, 11px); overflow-wrap: anywhere; }
                .chip button { min-height: 20px; height: auto; border: 0; padding: 0 3px; background: transparent; font-size: inherit; }
                .chip.inherited { border-style: dashed; }
                .association-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 6px; margin: 8px 0 14px; }
                .children { display: grid; gap: 5px; margin: 10px 0; }
                .child-link { text-align: left; overflow-wrap: anywhere; }
                h3 { margin: 18px 0 8px; font-size: var(--font-md, 12px); color: var(--muted, #697177); }
                .child-form { display: flex; gap: 6px; }
                .child-form input { flex: 1; }
                .footer { display: flex; justify-content: space-between; gap: 10px; margin-top: 16px; align-items: center; }
                .age { color: var(--muted, #697177); font-size: var(--font-xs, 10px); }
                .delete { color: var(--muted, #697177); font-size: var(--font-md, 12px); }
                .delete.armed { color: var(--accent, #D00E00); }
                @media (max-width: 520px) { .association-form { grid-template-columns: 1fr 1fr; } .association-form button { grid-column: 1 / -1; } }
                @media (max-width: 720px) { textarea, input, select { font-size: max(16px, var(--font-base, 13px)); } }
            </style>
            <article>
                <label>${escapeHTML(t(`ui.text.${singular}`))}<textarea class="text" rows="1" maxlength="1000" aria-label="${escapeHTML(t('ui.text.value1Title', { value1: t(`ui.text.${singular}`) }))}"></textarea></label>
                ${this.renderDetails()}
                ${this.renderRelationships()}
                <div class="chips" aria-label="${escapeHTML(t('ui.text.associations'))}"></div>
                <form class="association-form">
                    <input class="association-type" list="planning-types" maxlength="60" placeholder="${escapeHTML(t('ui.text.property'))}" aria-label="${escapeHTML(t('ui.text.associationProperty'))}" required>
                    <datalist id="planning-types"></datalist>
                    <input class="association-value" list="planning-values" maxlength="120" placeholder="${escapeHTML(t('ui.text.chooseOrTypeAValue'))}" aria-label="${escapeHTML(t('ui.text.associationValue'))}" required>
                    <datalist id="planning-values"></datalist>
                    <button type="submit">${escapeHTML(t('ui.text.addAssociation'))}</button>
                </form>
                <h3 class="children-heading">${escapeHTML(t(this.childrenTitleKey))} · ${children.length}</h3>
                <div class="children"></div>
                <form class="child-form"><input class="child-text" maxlength="1000" aria-label="${escapeHTML(t('ui.text.newValue7', { value7: uiLabel(childKind.slice(0, -1)) }))}" placeholder="${escapeHTML(t(this.childPlaceholderKey))}" required><button type="submit">${escapeHTML(t('ui.text.addValue9', { value9: uiLabel(childKind.slice(0, -1)) }))}</button></form>
                <div class="footer"><span class="age"></span><button class="delete" type="button">${escapeHTML(t('ui.text.deleteValue10', { value10: uiLabel(singular) }))}</button></div>
            </article>
        `;
        for (const field of this.editableFields) {
            const input = this.shadowRoot.querySelector(this.fieldSelector(field));
            input.value = this._record[field] ?? '';
            const save = () => {
                clearTimeout(this._saveTimers[field]);
                delete this._saveTimers[field];
                const value = this.untrimmedFields.includes(field) ? input.value : input.value.trim();
                if (field === 'text' && !value) { input.value = this._record.text; return; }
                if (value !== this._record[field]) this.emit('planning-update', { patch: { [field]: value }, quiet: true });
            };
            input.addEventListener('input', () => {
                clearTimeout(this._saveTimers[field]);
                this._saveTimers[field] = setTimeout(save, 550);
            });
            input.addEventListener('blur', save);
        }
        this.bindDetails(goalParents);
        this.bindWantParent(parents);
        this.renderAssociationChips(associations);
        const type = this.shadowRoot.querySelector('.association-type');
        const value = this.shadowRoot.querySelector('.association-value');
        this.refreshCatalog(catalog);
        type.addEventListener('input', () => {
            const values = this.shadowRoot.querySelector('#planning-values');
            values.replaceChildren();
            for (const name of this._catalog[canonicalType(type.value)] || []) values.append(new Option(name, name));
        });
        this.shadowRoot.querySelector('.association-form').addEventListener('submit', event => {
            event.preventDefault();
            this.emit('planning-association-add', { association: { type: type.value, value: value.value } });
        });
        this.renderChildren(children);
        this.shadowRoot.querySelector('.child-form').addEventListener('submit', event => {
            event.preventDefault();
            const input = this.shadowRoot.querySelector('.child-text');
            const parsed = parseQuickTask(input.value);
            if (parsed.text) {
                this.emit('planning-child-add', { input: parsed });
                input.value = '';
            }
        });
        this.shadowRoot.querySelector('.age').textContent = t('ui.text.createdValue0', { value0: new Date(this._record.createdAt).toLocaleDateString() });
        this.shadowRoot.querySelector('.delete').addEventListener('click', event => {
            const button = event.currentTarget;
            if (button.classList.contains('armed')) this.emit('planning-delete');
            else {
                button.classList.add('armed');
                button.textContent = t('ui.text.confirmDeleteKeepsValue0', { value0: uiLabel(childKind) });
                this._confirmTimer = setTimeout(() => {
                    button.classList.remove('armed');
                    button.textContent = t('ui.text.deleteValue0', { value0: uiLabel(singular) });
                }, 3500);
            }
        });
    }

    renderAssociationChips(associations) {
        const ownKeys = new Set(this._record.associations.map(item => `${item.type}\u0000${item.value.toLowerCase()}`));
        const chips = this.shadowRoot.querySelector('.chips');
        chips.replaceChildren();
        for (const association of associations) {
            const own = ownKeys.has(`${association.type}\u0000${association.value.toLowerCase()}`);
            const chip = document.createElement('span');
            chip.className = `chip${own ? '' : ' inherited'}`;
            chip.textContent = `${association.type}: ${association.value}${own ? '' : t('ui.text.fromValue0', { value0: uiLabel(this.childKind) })}`;
            if (own) {
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.textContent = '×';
                remove.setAttribute('aria-label', t('ui.text.removeValue0Value1', { value0: association.type, value1: association.value }));
                remove.addEventListener('click', () => this.emit('planning-association-remove', { association }));
                chip.append(remove);
            }
            chips.append(chip);
        }
    }

    renderChildren(children) {
        const childList = this.shadowRoot.querySelector('.children');
        childList.replaceChildren();
        for (const child of children) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'child-link';
            button.textContent = `${child.status === 'done' || child.achieved ? '✓ ' : ''}${child.text}`;
            button.addEventListener('click', () => this.emit('planning-navigate', { targetKind: child.targetKind || this.childKind, targetId: child.id }));
            childList.append(button);
        }
    }
}
