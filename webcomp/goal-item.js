import { PlanningItem } from './planning-item.js';

export class GoalItem extends PlanningItem {
    static kind = 'goals';
    get childKind() { return 'plans'; }
    get childrenTitleKey() { return 'ui.text.plansForGoal'; }
    get childPlaceholderKey() { return 'ui.text.turnThisWantIntoAPlan'; }
    get editableFields() { return ['text', 'notes', 'successCriteria', 'targetDate']; }

    renderDetails() {
        return `
            <label>${escapeHTML(t('ui.text.successCriteria'))}<textarea class="successCriteria" rows="3" maxlength="10000" placeholder="${escapeHTML(t('ui.text.successPlaceholder'))}"></textarea></label>
            <label>${escapeHTML(t('ui.text.targetDate'))}<input class="targetDate" type="date"></label>
            <label class="achieved-label"><input class="achieved" type="checkbox">${escapeHTML(t('ui.text.achieved'))}</label>
            <label>${escapeHTML(t('ui.text.goalNotes'))}<textarea class="notes" rows="3" maxlength="10000"></textarea></label>`;
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
