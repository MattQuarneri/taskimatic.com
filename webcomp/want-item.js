import { PlanningItem } from './planning-item.js';

export class WantItem extends PlanningItem {
    static kind = 'wants';
    get childKind() { return 'goals'; }
    get childrenTitleKey() { return 'ui.text.goalsAndPlansFromWant'; }
    get childPlaceholderKey() { return 'ui.text.turnWantIntoGoal'; }
    get editableFields() { return ['text', 'notes']; }

    renderDetails() {
        return `<label>${escapeHTML(t('ui.text.ideasAspirationsAndPossibilities'))}<textarea class="notes" rows="5" maxlength="10000" aria-label="${escapeHTML(t('ui.text.wantNotes'))}" placeholder="${escapeHTML(t('ui.text.makeRoomForYourThinking'))}"></textarea></label>`;
    }
}

customElements.define('want-item', WantItem);
