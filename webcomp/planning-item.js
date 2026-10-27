import { createFilePill, installFileAssociationEditor } from '../js/file-associations.js';
import { COMMON_PROPERTIES, cloneValue, canonicalType, parseQuickTask } from '../js/task-model.js';
export class PlanningItem extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._saveTimers = {};
        this._confirmTimer = null;
        this._model = null;
        this._unsubscribe = null;
        this._selectedTab = null;
        this._lastTab = null;
    }

    setData({ kind, record, parents = [], children = [], associations = record.associations || [], catalog = {}, goalParents = [], selectedTab = this._selectedTab }) {
        this.kind = this.constructor.kind || kind;
        this._selectedTab = selectedTab;
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
        this.resizeTitle();
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

    get detailTabs() { return []; }
    get tabs() {
        return [...this.detailTabs, { id: 'associations', label: t('ui.text.associations') }, { id: 'children', label: t(this.childKind === 'goals' ? 'ui.text.goalsTab' : `ui.text.${this.childKind}`) }];
    }

    renderSummary() { return ''; }

    selectTab(tab, toggle = false) {
        this._selectedTab = toggle && this._selectedTab === tab ? null : tab;
        this.updateTabs();
        this.emit('planning-tab-change', { tab: this._selectedTab });
    }

    updateTabs() {
        if (!this.tabs.some(tab => tab.id === this._selectedTab)) this._selectedTab = null;
        if (this._selectedTab) this._lastTab = this._selectedTab;
        this.shadowRoot.querySelectorAll('[data-planning-tab]').forEach(tab => {
            const active = tab.dataset.planningTab === this._selectedTab;
            tab.setAttribute('aria-selected', String(active));
            tab.setAttribute('aria-expanded', String(active));
            tab.tabIndex = tab.dataset.planningTab === (this._selectedTab || this._lastTab || this.tabs[0].id) ? 0 : -1;
        });
        this.shadowRoot.querySelectorAll('[data-planning-panel]').forEach(panel => {
            panel.hidden = panel.dataset.planningPanel !== this._selectedTab;
        });
        this.shadowRoot.querySelector('.planning-card').setAttribute('data-collapsed', String(this._selectedTab === null));
    }

    resizeTitle() {
        const input = this.shadowRoot.querySelector('.text');
        input.style.height = 'auto';
        input.style.height = `${Math.min(150, Math.max(30, input.scrollHeight))}px`;
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
                article { padding: 8px 8px 6px; border: 1px solid var(--ink, #18242b); border-radius: 12px; background: var(--panel, #fffdf7); box-shadow: 3px 3px 0 rgba(24,36,43,.11); }
                :host([attention]) article { outline: 3px solid var(--blue, #315f91); }
                button, input, select, textarea { font: inherit; color: inherit; }
                button { min-height: 32px; height: auto; border: 1px solid var(--line, #cfc8b8); border-radius: 7px; padding: 4px 10px; background: var(--paper, #f3efe4); cursor: pointer; font-size: var(--font-md, 12px); }
                button:hover { border-color: var(--ink, #18242b); }
                button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 3px solid rgba(49,95,145,.28); outline-offset: 2px; }
                label { display: grid; gap: 5px; margin-bottom: 6px; color: var(--muted, #697177); font-size: var(--font-xs, 10px); }
                textarea, input, select { width: 100%; min-width: 0; min-height: 34px; border: 1px solid var(--line, #cfc8b8); border-radius: 8px; background: var(--panel, #fffdf7); padding: 8px; color: var(--ink, #18242b); font-size: var(--font-base, 13px); }
                .title-row { display: flex; align-items: start; gap: 8px; }
                .text { display: block; flex: 1; width: 100%; min-height: 60px; max-height: 150px; border: 0; padding: 2px 3px; background: transparent; font-size: var(--font-xl, 16px); font-weight: 720; line-height: 1.45; resize: vertical; overflow: auto; }
                .planning-tabs { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 9px; }
                .planning-tabs button { min-height: max(24px, 1.8em); padding: 3px 7px; border-bottom: 0; border-radius: 6px 6px 0 0; background: transparent; color: var(--muted, #697177); font-size: var(--font-xs, 10px); }
                .planning-tabs button[aria-selected="true"] { background: var(--ink, #18242b); color: white; border-color: var(--ink, #18242b); }
                [data-planning-panel] { min-width: 0; }
                button[role="tab"]:hover { background: var(--panel, #fffdf7); color: var(--ink, #18242b); }
                .notes, .my-thinking, .ai-thinking, .successCriteria { min-height: 48px; height: 10em; max-height: 180px; border-radius: 0 8px 8px 8px; background: rgba(245,240,229,.55); resize: vertical; line-height: 1.45; font-size: var(--font-lg, 14px); }
                .achieved-label { display: flex; align-items: center; gap: 4px; margin: 3px 0 0; }
                .achieved { width: auto; min-height: 20px; }
                .parent-row { display: flex; gap: 8px; }
                .parent-row select { flex: 1; }
                .chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 10px 0; }
                .chip { display: inline-flex; align-items: center; gap: 5px; min-height: 22px; height: auto; border: 1px solid var(--line, #cfc8b8); border-radius: 999px; padding: 4px 8px; color: var(--blue, #315f91); background: rgba(49,95,145,.06); font-size: var(--font-sm, 11px); overflow-wrap: anywhere; }
                .chip button { min-height: 20px; height: auto; border: 0; padding: 0 3px; background: transparent; font-size: inherit; }
                .chip.inherited { border-style: dashed; }
                .file-source { display: flex; gap: 2px; grid-column: 1 / -1; }
                .file-source[hidden], .association-local-file[hidden] { display: none; }
                .file-source button { min-height: 28px; padding: 4px 12px; }
                .file-source button[aria-checked="true"] { background: var(--blue, #315f91); color: white; }
                .association-local-file { grid-column: 1 / -1; }
                .file-pill { color: inherit; text-decoration: none; cursor: pointer; }
                .association-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 6px; margin: 8px 0 14px; }
                .association-property-row { display: contents; }
                .association-form[data-file-association="true"] { grid-template-columns: minmax(0, 3fr) minmax(0, 1fr); }
                .association-form[data-file-association="true"] > .association-property-row { display: flex; grid-area: 1 / 1; align-items: center; gap: 5px; min-width: 0; }
                .association-form[data-file-association="true"] .association-property-select { flex: 0 1 120px; min-width: 0; }
                .association-form[data-file-association="true"] .file-source { flex: 0 0 auto; min-width: 0; }
                .association-form[data-file-association="true"] .file-source button { padding-inline: 4px; }
                .association-form[data-file-association="true"] > .association-value,
                .association-form[data-file-association="true"] > .association-local-file { grid-area: 2 / 1; width: 100%; }
                .association-form[data-file-association="true"] > button[type="submit"] { grid-area: 2 / 2; min-width: 0; padding-inline: 2px; }
                .association-form[data-file-association="true"] .association-type:not([hidden]) { flex: 1 1 0; min-width: 0; }
                .children { display: grid; gap: 5px; margin: 10px 0; }
                .child-link { text-align: left; overflow-wrap: anywhere; }
                h3 { margin: 0 0 8px; font-size: var(--font-md, 12px); color: var(--muted, #697177); }
                .child-form { display: flex; gap: 6px; }
                .child-form input { flex: 1; }
                .footer { display: flex; justify-content: space-between; gap: 10px; margin-top: 5px; align-items: center; }
                .age { color: var(--muted, #697177); font-size: var(--font-xs, 10px); }
                .delete { min-height: 27px; border: 0; padding: 4px 0; background: transparent; color: var(--muted, #697177); font-size: var(--font-xs, 10px); }
                .delete.armed { color: var(--accent, #D00E00); }
                @media (max-width: 520px) { .association-form { grid-template-columns: 1fr 1fr; } .association-form button { grid-column: 1 / -1; } }
                @media (max-width: 888px) {
                    .planning-tabs { flex-wrap: nowrap; overflow-x: auto; border-bottom: 1px solid var(--line, #cfc8b8); }
                    .planning-tabs button { flex: 1; min-height: 16px; padding: 6px; border: 0; white-space: nowrap; }
                    [data-planning-panel] { padding: 10px 0; }
                    .notes, .my-thinking, .ai-thinking { min-height: 100px; border-radius: 8px; }
                    .planning-card[data-collapsed="true"] .footer { display: none; }
                }
                @media (max-width: 520px) { textarea, input, select { font-size: max(16px, var(--font-base, 13px)); } }
            </style>
            <article class="planning-card">
                <div class="title-row"><textarea class="text" rows="1" maxlength="1000" aria-label="${escapeHTML(t('ui.text.value1Title', { value1: t(`ui.text.${singular}`) }))}"></textarea>${this.renderSummary()}</div>
                <div class="planning-tabs" role="tablist" aria-label="${escapeHTML(t(`ui.text.${singular}`))}">
                    ${this.tabs.map(tab => `<button type="button" role="tab" id="planning-${tab.id}-tab" data-planning-tab="${tab.id}" aria-controls="planning-${tab.id}-panel">${escapeHTML(tab.label)}</button>`).join('')}
                </div>
                ${this.renderDetails()}
                <div role="tabpanel" tabindex="0" id="planning-associations-panel" data-planning-panel="associations" aria-labelledby="planning-associations-tab" hidden>
                ${this.renderRelationships()}
                <div class="chips" aria-label="${escapeHTML(t('ui.text.associations'))}"></div>
                <form class="association-form">
                    <div class="association-property-row">
                    <select class="association-property-select" aria-label="Association property" required></select>
                        <input hidden class="association-type" list="planning-types" maxlength="60" placeholder="${escapeHTML(t('ui.text.property'))}" aria-label="Custom association property" required>
                    <datalist id="planning-types"></datalist>
                    <div class="file-source" role="radiogroup" aria-label="File source" hidden>
                            <button type="button" role="radio" data-file-mode="link" aria-checked="true">Link</button>
                            <button type="button" role="radio" data-file-mode="local" aria-checked="false">Local</button>
                        </div>
                    </div>
                        <input class="association-local-file" type="file" aria-label="Local file" hidden>
                        <input class="association-value" list="planning-values" maxlength="4096" placeholder="${escapeHTML(t('ui.text.chooseOrTypeAValue'))}" aria-label="${escapeHTML(t('ui.text.associationValue'))}" required>
                    <datalist id="planning-values"></datalist>
                    <button type="submit">${escapeHTML(t('ui.text.addAssociation'))}</button>
                </form>
                </div>
                <div role="tabpanel" tabindex="0" id="planning-children-panel" data-planning-panel="children" aria-labelledby="planning-children-tab" hidden>
                <h3 class="children-heading">${escapeHTML(t(this.childrenTitleKey))} · ${children.length}</h3>
                <div class="children"></div>
                <form class="child-form"><input class="child-text" maxlength="1000" aria-label="${escapeHTML(t('ui.text.newValue7', { value7: uiLabel(childKind.slice(0, -1)) }))}" placeholder="${escapeHTML(t(this.childPlaceholderKey))}" required><button type="submit">${escapeHTML(t('ui.text.addValue9', { value9: uiLabel(childKind.slice(0, -1)) }))}</button></form>
                </div>
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
                if (field === 'text') this.resizeTitle();
                clearTimeout(this._saveTimers[field]);
                this._saveTimers[field] = setTimeout(save, 550);
            });
            input.addEventListener('blur', save);
        }
        this.resizeTitle();
        this.shadowRoot.querySelectorAll('[data-planning-tab]').forEach(tab => {
            tab.addEventListener('click', () => this.selectTab(tab.dataset.planningTab, true));
            tab.addEventListener('keydown', event => {
                const tabs = [...this.shadowRoot.querySelectorAll('[data-planning-tab]')];
                const index = tabs.indexOf(tab);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                    : event.key === 'ArrowRight' ? (index + 1) % tabs.length
                    : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : -1;
                if (next < 0) return;
                event.preventDefault();
                this.selectTab(tabs[next].dataset.planningTab);
                tabs[next].focus();
            });
        });
        this.updateTabs();
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
        installFileAssociationEditor(this.shadowRoot.querySelector('.association-form'), type, value, [...COMMON_PROPERTIES, ...Object.keys(catalog)], association => this.emit('planning-association-add', { association }));
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
            if (association.type === 'file') {
                chip.append(createFilePill(association));
                if (!own) {
                    const origin = document.createElement('span');
                    origin.textContent = t('ui.text.fromValue0', { value0: uiLabel(this.childKind) });
                    chip.append(origin);
                }
            } else chip.textContent = `${association.type}: ${association.value}${own ? '' : t('ui.text.fromValue0', { value0: uiLabel(this.childKind) })}`;
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
