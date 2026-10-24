import { PlanningItem } from './planning-item.js';

export class GoalItem extends PlanningItem {
    static kind = 'goals';
    get childKind() { return 'plans'; }
    get childrenTitleKey() { return 'ui.text.plansForGoal'; }
    get childPlaceholderKey() { return 'ui.text.turnThisWantIntoAPlan'; }
    get editableFields() { return ['text', 'notes', 'successCriteria', 'targetDate']; }

    get detailTabs() {
        return [{ id: 'outcome', label: t('ui.text.goal') }, { id: 'notes', label: t('ui.text.notes') }];
    }

    renderSummary() {
        return `<label class="achieved-label"><input class="achieved" type="checkbox">${escapeHTML(t('ui.text.achieved'))}</label>`;
    }

    renderDetails() {
        return `
            <div role="tabpanel" tabindex="0" id="planning-outcome-panel" data-planning-panel="outcome" aria-labelledby="planning-outcome-tab" hidden>
                <label>${escapeHTML(t('ui.text.successCriteria'))}<textarea class="successCriteria" rows="1" maxlength="10000" placeholder="${escapeHTML(t('ui.text.successPlaceholder'))}"></textarea></label>
                <label>${escapeHTML(t('ui.text.targetDate'))}<input class="targetDate" type="date"></label>
            </div>
            <div role="tabpanel" tabindex="0" id="planning-notes-panel" data-planning-panel="notes" aria-labelledby="planning-notes-tab" hidden><textarea class="notes" rows="2" maxlength="10000" aria-label="${escapeHTML(t('ui.text.goalNotes'))}"></textarea></div>`;
    }

    renderRelationships() {
        return this.renderWantParent();
    }

    bindDetails() {
        const achieved = this.shadowRoot.querySelector('.achieved');
        achieved.checked = this._record.achieved;
        achieved.addEventListener('change', () => this.emit('planning-update', { patch: { achieved: achieved.checked } }));
    }
}

customElements.define('goal-item', GoalItem);
