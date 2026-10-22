import { PlanningItem } from './planning-item.js';

export class PlanItem extends PlanningItem {
    static kind = 'plans';
    get childKind() { return 'tasks'; }
    get childrenTitleKey() { return 'ui.text.tasksInThisPlan'; }
    get childPlaceholderKey() { return 'ui.text.turnANextStepIntoATask'; }
    get editableFields() { return ['text', 'myThinking', 'aiThinking']; }

    renderDetails() {
        return `
            <div class="thinking-tabs" role="tablist" aria-label="${escapeHTML(t('ui.text.planThinking'))}">
                <button type="button" id="my-thinking-tab" role="tab" data-thinking-tab="myThinking" aria-controls="my-thinking-panel">${escapeHTML(t('ui.text.myThinking'))}</button>
                <button type="button" id="ai-thinking-tab" role="tab" data-thinking-tab="aiThinking" aria-controls="ai-thinking-panel">${escapeHTML(t('ui.text.aIThinking'))}</button>
            </div>
            <div role="tabpanel" id="my-thinking-panel" data-thinking-panel="myThinking" aria-labelledby="my-thinking-tab"><label>${escapeHTML(t('ui.text.myThinkingApproachAndNextSteps'))}<textarea class="my-thinking" rows="5" maxlength="50000" aria-label="${escapeHTML(t('ui.text.myThinking'))}" placeholder="${escapeHTML(t('ui.text.makeRoomForYourThinking'))}"></textarea></label></div>
            <div role="tabpanel" id="ai-thinking-panel" data-thinking-panel="aiThinking" aria-labelledby="ai-thinking-tab"><label>${escapeHTML(t('ui.text.aIThinking2'))}<textarea class="ai-thinking" rows="5" maxlength="50000" aria-label="${escapeHTML(t('ui.text.aIThinking'))}" placeholder="${escapeHTML(t('ui.text.saveTextGeneratedByAI'))}"></textarea></label></div>`;
    }

    renderRelationships() {
        return this.renderWantParent() + `<label>${escapeHTML(t('ui.text.goalOptional'))}<span class="parent-row"><select class="goal-parent" aria-label="${escapeHTML(t('ui.text.parentGoal'))}"></select><button class="open-goal" type="button" ${this._record.goalId ? '' : 'hidden'}>${escapeHTML(t('ui.text.openGoal'))}</button></span></label>`;
    }

    get untrimmedFields() { return ['myThinking', 'aiThinking']; }

    updateThinkingTabs() {
        this.shadowRoot.querySelectorAll('[data-thinking-tab]').forEach(tab => {
            const active = tab.dataset.thinkingTab === this._thinkingTab;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
        });
        this.shadowRoot.querySelectorAll('[data-thinking-panel]').forEach(panel => { panel.hidden = panel.dataset.thinkingPanel !== this._thinkingTab; });
    }

    bindDetails(goalParents) {
        this.shadowRoot.querySelectorAll('[data-thinking-tab]').forEach(tab => {
            tab.addEventListener('click', () => {
                this._thinkingTab = tab.dataset.thinkingTab;
                this.updateThinkingTabs();
                this.emit('planning-thinking-tab-change', { tab: this._thinkingTab });
            });
            tab.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 'myThinking' : event.key === 'End' ? 'aiThinking' : this._thinkingTab === 'myThinking' ? 'aiThinking' : 'myThinking';
                const nextTab = this.shadowRoot.querySelector(`[data-thinking-tab="${next}"]`);
                nextTab.click();
                nextTab.focus();
            });
        });
        this.updateThinkingTabs();
        const goal = this.shadowRoot.querySelector('.goal-parent');
        goal.append(new Option(t('ui.text.noGoal'), ''), ...goalParents.map(record => new Option(record.text, record.id)));
        goal.value = this._record.goalId || '';
        goal.addEventListener('change', () => this.emit('planning-update', { patch: { goalId: goal.value || null } }));
        this.shadowRoot.querySelector('.open-goal').addEventListener('click', () => this.emit('planning-navigate', { targetKind: 'goals', targetId: this._record.goalId }));
    }
}

customElements.define('plan-item', PlanItem);
