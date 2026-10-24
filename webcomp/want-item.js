import { PlanningItem } from './planning-item.js';

export class WantItem extends PlanningItem {
    static kind = 'wants';
    get childKind() { return 'goals'; }
    get childrenTitleKey() { return 'ui.text.goalsAndPlansFromWant'; }
    get childPlaceholderKey() { return 'ui.text.turnWantIntoGoal'; }
    get editableFields() { return ['text', 'notes']; }

    get detailTabs() { return [{ id: 'notes', label: t('ui.text.notes') }]; }

    renderDetails() {
        return `<div role="tabpanel" tabindex="0" id="planning-notes-panel" data-planning-panel="notes" aria-labelledby="planning-notes-tab" hidden><textarea class="notes" rows="2" maxlength="10000" aria-label="${escapeHTML(t('ui.text.wantNotes'))}" placeholder="${escapeHTML(t('ui.text.makeRoomForYourThinking'))}"></textarea></div>`;
    }
}

customElements.define('want-item', WantItem);
