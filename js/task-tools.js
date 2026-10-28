import { cloneValue } from './task-model.js';
import { analyticsFor } from './task-analytics.js';

const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string' };
const id = { type: 'string', minLength: 1 };
const link = { type: ['string', 'null'] };
const boolean = { type: 'boolean' };
const association = object({ type: id, value: id, file: object({ id, name: string, mime: string, size: { type: 'number', minimum: 0 } }, ['id']) }, ['type', 'value']);
const associations = { type: 'array', items: association };
const fields = {
    Task: { text: id, notes: string, prompts: string, estimatedMinutes: { enum: [10, 30, 60, 90, null] }, agentId: link, planId: link, status: { enum: ['open', 'done'] }, today: boolean, tabled: boolean, associations },
    Plan: { text: id, myThinking: string, aiThinking: string, goalId: link, wantId: link, associations },
    Goal: { text: id, successCriteria: string, targetDate: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, achieved: boolean, notes: string, wantId: link, associations },
    Want: { text: id, notes: string, associations }
};

// Validate the schema subset used by this registry, before any workspace action runs.
function validate(schema, value, path = 'arguments') {
    if (schema.enum && !schema.enum.includes(value)) throw new TypeError(`${path} must be one of ${JSON.stringify(schema.enum)}`);
    if (schema.type) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
        if (!types.includes(type) && !(types.includes('integer') && Number.isInteger(value))) throw new TypeError(`${path} must be ${types.join(' or ')}`);
    }
    if (typeof value === 'number' && (!Number.isFinite(value) || (schema.minimum !== undefined && value < schema.minimum))) throw new TypeError(`${path} is out of range`);
    if (typeof value === 'string' && ((schema.minLength && value.trim().length < schema.minLength) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) throw new TypeError(`${path} is invalid`);
    if (Array.isArray(value) && schema.items) value.forEach((item, index) => validate(schema.items, item, `${path}[${index}]`));
    if (value && typeof value === 'object' && !Array.isArray(value) && schema.properties) {
        for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new TypeError(`${path}.${key} is required`);
        for (const [key, item] of Object.entries(value)) {
            if (!Object.hasOwn(schema.properties, key)) {
                if (schema.additionalProperties === false) throw new TypeError(`${path}.${key} is not supported`);
            } else validate(schema.properties[key], item, `${path}.${key}`);
        }
    }
}

export function createTaskToolRegistry(getWorkspace) {
    const entries = new Map();
    const register = (name, description, parameters, execute, readOnly = false) => {
        if (entries.has(name)) throw new Error(`Tool already registered: ${name}`);
        const definition = { name, description, parameters, annotations: { readOnly, destructive: name.startsWith('delete') || name === 'importData' } };
        entries.set(name, { definition, execute });
    };
    for (const [entity, properties] of Object.entries(fields)) {
        const kind = `${entity.toLowerCase()}s`;
        register(`create${entity}`, `Create a ${entity.toLowerCase()}. Returns the saved record. Parent links are optional IDs; obtain IDs from list tools.`, object({ input: object(properties, ['text']) }, ['input']), (w, a) => entity === 'Task' ? w.createTask(a.input) : w.createPlanning(kind, a.input));
        register(`update${entity}`, `Edit fields on a ${entity.toLowerCase()} by ID. Omitted fields stay unchanged; null clears a parent link. Associations replaces the record's own associations. Returns the saved record.`, object({ id, patch: object(properties) }, ['id', 'patch']), (w, a, context) => entity === 'Task' ? w.updateTask(a.id, a.patch, context) : w.updatePlanning(kind, a.id, a.patch, context));
        const query = { search: string, association };
        if (entity === 'Task') Object.assign(query, { status: { enum: ['open', 'tabled', 'done', 'all'] }, today: boolean, planId: link, agentId: link });
        if (entity === 'Plan') Object.assign(query, { goalId: link, wantId: link });
        if (entity === 'Goal') query.wantId = link;
        register(`list${entity}s`, `List ${kind}, optionally filtered. Returns complete records with IDs${entity === 'Task' ? ', timer state and time sessions' : ' and derived effectiveAssociations (including child associations)'}. No filters returns all records.`, object({ query: object(query) }), (w, a) => entity === 'Task' ? w.listTasks(a.query || {}) : w.listPlanning(kind, a.query || {}), true);
        register(`delete${entity}`, `Delete a ${entity.toLowerCase()} by ID.${entity === 'Task' ? ' Removes its time history too.' : ' Keeps child records and unlinks them.'} Returns {id, deleted}.`, object({ id }, ['id']), (w, a) => entity === 'Task' ? w.deleteTask(a.id) : w.deletePlanning(kind, a.id));
        for (const action of ['add', 'remove']) {
            register(`${action}${entity}Association`, `${action === 'add' ? 'Add an association without replacing existing associations' : 'Remove an own association by type and value'} on a ${entity.toLowerCase()}. Types are normalized; values match case-insensitively. File links use type "file" and a URL value; stored files may include file metadata. Returns the saved record.`, object({ id, association }, ['id', 'association']), (w, a) => w[`${action}EntityAssociation`](kind, a.id, a.association));
        }
    }
    register('createChild', 'Create a linked child: want → goal, goal → plan, plan → task. Returns the saved child. Use createPlan with wantId for a plan directly under a want.', object({ kind: { enum: ['wants', 'goals', 'plans'] }, id, input: object({ ...fields.Task, ...fields.Plan, ...fields.Goal, ...fields.Want }, ['text']) }, ['kind', 'id', 'input']), (w, a) => {
        validate(object(fields[a.kind === 'plans' ? 'Task' : a.kind === 'goals' ? 'Plan' : 'Goal'], ['text']), a.input, 'arguments.input');
        return w.createPlanningChild(a.kind, a.id, a.input);
    });
    register('setTaskPriority', 'Move an open task to a priority position (1 is highest), shifting other tasks. null clears its priority. Returns the saved task.', object({ id, priority: { type: ['integer', 'null'], minimum: 1 } }, ['id', 'priority']), (w, a) => w.setTaskPriority(a.id, a.priority));
    for (const action of ['start', 'stop']) register(`${action}Timer`, `${action === 'start' ? 'Start' : 'Stop and log'} a task timer. Actor defaults to human. Starting a human timer stops the other human timer. Completed or tabled tasks must be reopened before starting. Returns the task.`, object({ id, actor: { enum: ['human', 'agent'] } }, ['id']), (w, a) => w[`${action}Timer`](a.id, a.actor || 'human'));
    register('updateSession', 'Edit an existing task time entry using ISO date-time strings. End must be at or after start; duration is recalculated. Returns the task.', object({ id, sessionId: id, patch: object({ startedAt: id, endedAt: id }, ['startedAt', 'endedAt']) }, ['id', 'sessionId', 'patch']), (w, a) => w.updateSession(a.id, a.sessionId, a.patch));
    register('deleteSession', 'Delete one time entry from a task. Returns the task.', object({ id, sessionId: id }, ['id', 'sessionId']), (w, a) => w.deleteSession(a.id, a.sessionId));
    register('createAgent', 'Create a named agent that can be assigned to tasks. Returns the agent record.', object({ input: object({ name: id }, ['name']) }, ['input']), (w, a) => w.createAgent(a.input));
    register('listAgents', 'List named agents and their IDs.', object(), w => cloneValue(w.agents), true);
    register('deleteAgent', 'Delete a named agent. Fails while any task is assigned to it.', object({ id }, ['id']), (w, a) => w.deleteAgent(a.id));
    register('getAnalytics', 'Read task/time analytics grouped by an association type. Empty groupBy selects individual tasks.', object({ options: object({ groupBy: string, measure: { enum: ['time', 'tasks'] }, days: { type: 'integer', minimum: 1 }, period: string }) }), (w, a) => analyticsFor(w.tasks, a.options || {}), true);
    register('exportData', 'Export all workspace records and settings as JSON. File bytes are backed up separately with taskimatic.fileRepo.', object(), w => w.exportData(), true);
    register('importData', 'Import a workspace export. Merge is the default; replace overwrites the workspace. File bytes must be imported separately.', object({ input: { type: ['object', 'array', 'string'] }, options: object({ strategy: { enum: ['merge', 'replace'] } }) }, ['input']), (w, a) => w.importData(a.input, a.options || {}));
    register('downloadApp', 'Download a portable HTML copy of the app and workspace. Returns a download summary.', object(), w => w.downloadApp());

    const registry = {
        register(definition, execute) {
            if (!definition || !/^[A-Za-z][A-Za-z0-9_]*$/.test(definition.name) || typeof definition.description !== 'string' || definition.parameters?.type !== 'object' || typeof execute !== 'function') throw new TypeError('Expected a tool name, description, object parameters schema, and execute function');
            const copy = cloneValue(definition);
            register(copy.name, copy.description, copy.parameters, (_workspace, args) => execute(args), copy.annotations?.readOnly === true);
        },
        list: () => cloneValue([...entries.values()].map(entry => entry.definition)),
        async call(name, args = {}, context = {}) {
            const entry = entries.get(name);
            if (!entry) throw new Error(`Unknown Taskimatic tool: ${name}`);
            validate(entry.definition.parameters, args);
            return cloneValue(await entry.execute(await getWorkspace(), args, context));
        },
        // Functions are kept out of list() so its output can cross JSON/message boundaries.
        forLoadTools: () => registry.list().map(definition => ({ ...definition, signature: definition.parameters, execute: args => registry.call(definition.name, args) }))
    };
    return Object.freeze(registry);
}
