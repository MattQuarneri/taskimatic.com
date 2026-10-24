import { PlanningItem } from './planning-item.js';

export class PlanItem extends PlanningItem {
    static kind = 'plans';
    get childKind() { return 'tasks'; }
    get childrenTitleKey() { return 'ui.text.tasksInThisPlan'; }
    get childPlaceholderKey() { return 'ui.text.turnANextStepIntoATask'; }
    get editableFields() { return ['text', 'myThinking', 'aiThinking']; }

    get detailTabs() {
        return [{ id: 'myThinking', label: t('ui.text.myThinking') }, { id: 'aiThinking', label: t('ui.text.aIThinking') }];
    }

    renderDetails() {
        return `
            <div role="tabpanel" tabindex="0" id="planning-myThinking-panel" data-planning-panel="myThinking" aria-labelledby="planning-myThinking-tab" hidden><textarea class="my-thinking" rows="2" maxlength="50000" aria-label="${escapeHTML(t('ui.text.myThinking'))}" placeholder="${escapeHTML(t('ui.text.makeRoomForYourThinking'))}"></textarea></div>
            <div role="tabpanel" tabindex="0" id="planning-aiThinking-panel" data-planning-panel="aiThinking" aria-labelledby="planning-aiThinking-tab" hidden><textarea class="ai-thinking" rows="5" maxlength="50000" aria-label="${escapeHTML(t('ui.text.aIThinking'))}" placeholder="${escapeHTML(t('ui.text.saveTextGeneratedByAI'))}"></textarea></div>`;
    }

    renderRelationships() {
        return this.renderWantParent() + `<label>${escapeHTML(t('ui.text.goalOptional'))}<span class="parent-row"><select class="goal-parent" aria-label="${escapeHTML(t('ui.text.parentGoal'))}"></select><button class="open-goal" type="button" ${this._record.goalId ? '' : 'hidden'}>${escapeHTML(t('ui.text.openGoal'))}</button></span></label>`;
    }

    get untrimmedFields() { return ['myThinking', 'aiThinking']; }

    bindDetails(goalParents) {
        const goal = this.shadowRoot.querySelector('.goal-parent');
        goal.append(new Option(t('ui.text.noGoal'), ''), ...goalParents.map(record => new Option(record.text, record.id)));
        goal.value = this._record.goalId || '';
        goal.addEventListener('change', () => this.emit('planning-update', { patch: { goalId: goal.value || null } }));
        this.shadowRoot.querySelector('.open-goal').addEventListener('click', () => this.emit('planning-navigate', { targetKind: 'goals', targetId: this._record.goalId }));
    }
}

customElements.define('plan-item', PlanItem);
