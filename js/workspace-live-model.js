import { cloneValue } from './task-model.js';
import { WORKSPACE_COLLECTIONS, planningAssociations } from './task-planning-model.js';

function immutable(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(immutable);
        Object.freeze(value);
    }
    return value;
}

// A reactive adapter over the workspace's compatibility state. Persistence and
// rendering stay outside the object; every subscriber sees the same revision.
export class WorkspaceLiveModel extends EventTarget {
    #current = immutable(Object.fromEntries(WORKSPACE_COLLECTIONS.map(kind => [kind, []])));
    #revision = 0;

    get current() { return this.#current; }
    get revision() { return this.#revision; }

    subscribe(listener) {
        const handler = event => listener(event.detail);
        this.addEventListener('workspace:change', handler);
        return () => this.removeEventListener('workspace:change', handler);
    }

    replace(workspace, { action = 'reconciled', source = null } = {}) {
        const changed = WORKSPACE_COLLECTIONS.filter(kind => JSON.stringify(workspace[kind]) !== JSON.stringify(this.#current[kind]));
        if (!changed.length) return false;
        this.#current = immutable(Object.fromEntries(WORKSPACE_COLLECTIONS.map(kind => [kind, cloneValue(workspace[kind])])));
        this.#revision += 1;
        this.dispatchEvent(new CustomEvent('workspace:change', { detail: Object.freeze({
            current: this.#current, revision: this.#revision, changed: Object.freeze(changed), action, source
        }) }));
        return true;
    }

    planningData(kind, id) {
        const record = this.#current[kind]?.find(item => item.id === id);
        if (!record) return null;
        const { tasks, plans, goals, wants } = this.#current;
        const catalog = Object.create(null);
        for (const item of [...tasks, ...plans, ...goals, ...wants]) for (const association of item.associations || []) {
            const values = catalog[association.type] ||= [];
            if (!values.includes(association.value)) values.push(association.value);
        }
        return {
            kind, record, parents: wants, goalParents: goals, catalog,
            associations: planningAssociations(kind, record, this.#current),
            children: kind === 'plans' ? tasks.filter(task => task.planId === id)
                : kind === 'goals' ? plans.filter(plan => plan.goalId === id)
                : [...goals.filter(goal => goal.wantId === id).map(goal => ({ ...goal, targetKind: 'goals' })),
                    ...plans.filter(plan => plan.wantId === id).map(plan => ({ ...plan, targetKind: 'plans' }))]
        };
    }
}
