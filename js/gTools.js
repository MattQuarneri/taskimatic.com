/**
 * Standalone Google Workspace Tools (Calendar, Contacts, Tasks) with
 * self-contained IndexedDB OAuth storage, backup export/import,
 * UTCP/JSON-Schema agent tool definitions, and human-in-the-loop approval.
 */

import { Calendar } from './calendarUI.js';

const DB_NAME = 'AgentStorage';
const STORE_NAME = 'credentials';
const TOKEN_KEY = 'google_calendar_token';
const CLIENT_ID_KEY = 'google_calendar_client_id';
const LEGACY_BACKUP_FORMAT = 'taskimatic-google-calendar-oauth';
const BACKUP_FORMAT = 'taskimatic-google-oauth';

export const DEFAULT_SCOPES = Object.freeze([
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/contacts',
    'https://www.googleapis.com/auth/tasks'
]);

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const PEOPLE_BASE = 'https://people.googleapis.com/v1';
const TASKS_BASE = 'https://tasks.googleapis.com/tasks/v1';

let idbWriteQueue = Promise.resolve();

function openDB() {
    if (typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('IndexedDB is not available in this environment.'));
    }
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function idbGet(id) {
    return idbWriteQueue.then(async () => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
            tx.oncomplete = () => db.close();
            tx.onabort = () => db.close();
        });
    });
}

function idbPut(record) {
    const op = idbWriteQueue.then(async () => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put({ ...record, savedAt: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted.'));
        }).finally(() => db.close());
    });
    idbWriteQueue = op.catch(() => {});
    return op;
}

function idbDelete(id) {
    const op = idbWriteQueue.then(async () => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('IndexedDB delete aborted.'));
        }).finally(() => db.close());
    });
    idbWriteQueue = op.catch(() => {});
    return op;
}

// --- Auth & Credentials ---
const auth = {
    DEFAULT_SCOPES,

    async getClientId() {
        const record = await idbGet(CLIENT_ID_KEY);
        return record?.clientId || '';
    },

    async setClientId(clientId) {
        const trimmed = typeof clientId === 'string' ? clientId.trim() : '';
        await idbPut({ id: CLIENT_ID_KEY, clientId: trimmed });
        return trimmed;
    },

    async getToken() {
        const record = await idbGet(TOKEN_KEY);
        return record?.token || null;
    },

    async setToken(token, expiresInSeconds) {
        if (typeof token !== 'string' || !token.trim()) {
            throw new Error('Access token must be a non-empty string.');
        }
        const expiresAt = Number.isFinite(Number(expiresInSeconds)) && Number(expiresInSeconds) > 0
            ? Date.now() + Number(expiresInSeconds) * 1000
            : null;
        await idbPut({ id: TOKEN_KEY, token: token.trim(), expiresAt });
        return token.trim();
    },

    async clearToken() {
        await idbDelete(TOKEN_KEY);
    },

    async getStatus() {
        const record = await idbGet(TOKEN_KEY);
        if (!record?.token) {
            return { authenticated: false, expired: false, expiresAt: null };
        }
        const expired = Boolean(record.expiresAt && Date.now() >= record.expiresAt - 30_000);
        return { authenticated: !expired, expired, expiresAt: record.expiresAt || null };
    },

    async isAuthenticated() {
        const status = await auth.getStatus();
        return status.authenticated;
    },

    async connect({ clientId, scopes = DEFAULT_SCOPES, prompt = 'consent' } = {}) {
        const resolvedClientId = (clientId ?? (await auth.getClientId())).trim();
        if (!resolvedClientId) {
            throw new Error('Google OAuth Client ID is required before connecting.');
        }
        if (clientId !== undefined) {
            await auth.setClientId(resolvedClientId);
        }

        const oauth2 = globalThis.google?.accounts?.oauth2;
        if (!oauth2?.initTokenClient) {
            throw new Error('Google Identity Services (https://accounts.google.com/gsi/client) is not loaded.');
        }

        const scopeString = Array.isArray(scopes) ? scopes.join(' ') : String(scopes);
        return new Promise((resolve, reject) => {
            const client = oauth2.initTokenClient({
                client_id: resolvedClientId,
                scope: scopeString,
                callback: async (tokenResponse) => {
                    if (tokenResponse?.error) {
                        reject(new Error(tokenResponse.error_description || tokenResponse.error));
                        return;
                    }
                    try {
                        await auth.setToken(tokenResponse.access_token, tokenResponse.expires_in);
                        resolve(tokenResponse);
                    } catch (err) {
                        reject(err);
                    }
                },
                error_callback: (err) => {
                    reject(new Error(err?.message || err?.type || 'Google authentication was cancelled or failed.'));
                }
            });
            client.requestAccessToken({ prompt });
        });
    },

    async exportBackup() {
        const record = await idbGet(TOKEN_KEY);
        if (!record?.token) {
            throw new Error('No credentials to export. Connect your Google account first.');
        }
        return {
            format: BACKUP_FORMAT,
            version: 2,
            clientId: await auth.getClientId(),
            accessToken: record.token,
            expiresAt: record.expiresAt || null,
            scopes: [...DEFAULT_SCOPES],
            exportedAt: new Date().toISOString()
        };
    },

    async downloadBackup(filename = 'google-tools-oauth.json') {
        const backup = await auth.exportBackup();
        const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return backup;
    },

    async importBackup(input) {
        const backup = typeof input === 'string' ? JSON.parse(input) : input;
        const validFormat = backup && (backup.format === BACKUP_FORMAT || backup.format === LEGACY_BACKUP_FORMAT);
        if (!validFormat || typeof backup.clientId !== 'string' || typeof backup.accessToken !== 'string' || !backup.accessToken.trim()) {
            throw new Error('Please select a valid Google OAuth export JSON file.');
        }
        const clientId = await auth.setClientId(backup.clientId);
        const remainingSeconds = backup.expiresAt ? Math.max(0, Math.floor((backup.expiresAt - Date.now()) / 1000)) : undefined;
        await auth.setToken(backup.accessToken, remainingSeconds);
        return { clientId, format: backup.format, importedAt: new Date().toISOString() };
    }
};

// --- Authenticated Google REST Helper ---
function notifyAuthExpired() {
    if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        globalThis.dispatchEvent(new CustomEvent('gtools:auth-expired'));
    }
}

async function fetchAPI(url, options = {}) {
    const status = await auth.getStatus();
    if (status.expired) {
        await auth.clearToken();
        notifyAuthExpired();
        throw new Error('Google OAuth token expired. Please click Connect Google Account to re-authenticate.');
    }
    const token = await auth.getToken();
    if (!token) {
        throw new Error('Not authenticated with Google. Please connect your Google account first.');
    }

    const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
    };

    const response = await fetch(url, { ...options, headers });
    if (response.status === 204) return null;

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (response.status === 401) {
        await auth.clearToken();
        notifyAuthExpired();
        throw new Error('Google session expired or invalid. Please click Connect Google Account to re-authenticate.');
    }

    if (!response.ok) {
        const msg = data?.error?.message || `Google API request failed (${response.status})`;
        throw new Error(msg);
    }
    return data;
}

function toQueryString(params = {}) {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
            sp.set(key, String(value));
        }
    }
    const qs = sp.toString();
    return qs ? `?${qs}` : '';
}

function toISODateTime(value) {
    if (!value) return undefined;
    if (value instanceof Date) return value.toISOString();
    const str = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        return new Date(`${str}T00:00:00`).toISOString();
    }
    const parsed = new Date(str);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid date/time value: ${value}`);
    }
    return parsed.toISOString();
}

function dayBounds(dateInput = new Date()) {
    let base;
    if (dateInput instanceof Date) {
        base = dateInput;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateInput).trim())) {
        const [y, m, d] = String(dateInput).trim().split('-').map(Number);
        base = new Date(y, m - 1, d);
    } else {
        base = new Date(dateInput);
    }
    if (Number.isNaN(base.getTime())) {
        throw new Error(`Invalid date: ${dateInput}`);
    }
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
    const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
}

function localTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

// --- Google Calendar CRUD ---
const calendar = {
    async getEvents({ start, end, query, calendarId = 'primary', maxResults = 50, singleEvents = true, orderBy = 'startTime' } = {}) {
        const qs = toQueryString({
            timeMin: toISODateTime(start),
            timeMax: toISODateTime(end),
            q: query,
            maxResults,
            singleEvents,
            orderBy: singleEvents ? orderBy : undefined
        });
        const data = await fetchAPI(`${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events${qs}`);
        return data?.items || [];
    },

    async getDayEvents(date = new Date(), options = {}) {
        const { start, end } = dayBounds(date);
        return calendar.getEvents({ ...options, start, end });
    },

    async getTodayEvents(options = {}) {
        return calendar.getDayEvents(new Date(), options);
    },

    async getEvent(eventId, calendarId = 'primary') {
        if (!eventId) throw new Error('eventId is required.');
        return fetchAPI(`${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    },

    async newEvent({ summary, description, location, start, end, allDay = false, attendees, colorId, visibility, extendedProperties, timeZone = localTimeZone(), calendarId = 'primary' } = {}) {
        if (!summary) throw new Error('Event summary is required.');

        const payload = { summary };
        if (description !== undefined) payload.description = description;
        if (location !== undefined) payload.location = location;
        if (colorId !== undefined) payload.colorId = colorId;
        if (visibility !== undefined) payload.visibility = visibility;
        if (extendedProperties !== undefined) payload.extendedProperties = extendedProperties;

        if (allDay) {
            const startDate = start ? String(start).slice(0, 10) : new Date().toISOString().slice(0, 10);
            const endDate = end ? String(end).slice(0, 10) : (() => {
                const d = new Date(`${startDate}T00:00:00Z`);
                d.setUTCDate(d.getUTCDate() + 1);
                return d.toISOString().slice(0, 10);
            })();
            payload.start = { date: startDate };
            payload.end = { date: endDate };
        } else {
            const startDate = start ? new Date(toISODateTime(start)) : new Date();
            const endDate = end ? new Date(toISODateTime(end)) : new Date(startDate.getTime() + 60 * 60 * 1000);
            payload.start = { dateTime: startDate.toISOString(), timeZone };
            payload.end = { dateTime: endDate.toISOString(), timeZone };
        }

        if (Array.isArray(attendees) && attendees.length > 0) {
            payload.attendees = attendees.map((a) => (typeof a === 'string' ? { email: a } : a));
        }

        return fetchAPI(`${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    },

    async updateEvent(eventId, patch = {}, calendarId = 'primary') {
        if (!eventId) throw new Error('eventId is required.');
        const body = { ...patch };
        const tz = patch.timeZone || localTimeZone();
        delete body.timeZone;

        if (typeof patch.start === 'string' || patch.start instanceof Date) {
            body.start = /^\d{4}-\d{2}-\d{2}$/.test(String(patch.start))
                ? { date: String(patch.start) }
                : { dateTime: toISODateTime(patch.start), timeZone: tz };
        }
        if (typeof patch.end === 'string' || patch.end instanceof Date) {
            body.end = /^\d{4}-\d{2}-\d{2}$/.test(String(patch.end))
                ? { date: String(patch.end) }
                : { dateTime: toISODateTime(patch.end), timeZone: tz };
        }
        if (Array.isArray(patch.attendees)) {
            body.attendees = patch.attendees.map((a) => (typeof a === 'string' ? { email: a } : a));
        }

        return fetchAPI(`${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
            method: 'PATCH',
            body: JSON.stringify(body)
        });
    },

    async newScheduledTask({ title, notes, start, end, durationMinutes = 30, taskId, taskListId, colorId, calendarId = 'primary', timeZone = localTimeZone() } = {}) {
        if (!title || !String(title).trim()) throw new Error('Scheduled task title is required.');
        const startDate = start ? new Date(toISODateTime(start)) : new Date();
        const endDate = end ? new Date(toISODateTime(end)) : new Date(startDate.getTime() + Number(durationMinutes) * 60 * 1000);
        const privateProps = { gToolsKind: 'scheduledTask' };
        if (taskId) privateProps.taskId = String(taskId);
        if (taskListId) privateProps.taskListId = String(taskListId);

        return calendar.newEvent({
            summary: `☐ ${String(title).trim()}`,
            description: notes,
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            colorId,
            timeZone,
            calendarId,
            extendedProperties: { private: privateProps }
        });
    },

    async deleteEvent(eventId, calendarId = 'primary') {
        if (!eventId) throw new Error('eventId is required.');
        await fetchAPI(`${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
            method: 'DELETE'
        });
        return { id: eventId, calendarId, deleted: true };
    },

    async getColors() {
        return fetchAPI(`${CALENDAR_BASE}/colors`);
    },

    getUI(mode = 'day', { date = new Date(), calendarId = 'primary' } = {}) {
        return Calendar.connect(gTools, { mode, date, calendarId });
    }
};

// --- Google Contacts (People API v1) CRUD ---
function normalizePersonResource(resourceName) {
    if (!resourceName) throw new Error('Contact resourceName is required.');
    return resourceName.startsWith('people/') ? resourceName : `people/${resourceName}`;
}

function buildPersonPayload({ givenName, familyName, displayName, email, emails, phone, phones, organization, title, notes } = {}) {
    const payload = {};
    const fields = [];

    if (givenName !== undefined || familyName !== undefined || displayName !== undefined) {
        const nameObj = {};
        if (givenName !== undefined) nameObj.givenName = givenName;
        if (familyName !== undefined) nameObj.familyName = familyName;
        if (displayName !== undefined && givenName === undefined && familyName === undefined) {
            const parts = String(displayName).trim().split(/\s+/);
            nameObj.givenName = parts[0] || '';
            if (parts.length > 1) nameObj.familyName = parts.slice(1).join(' ');
        }
        payload.names = [nameObj];
        fields.push('names');
    }

    const emailList = emails ?? (email !== undefined ? [email] : undefined);
    if (emailList !== undefined) {
        payload.emailAddresses = emailList.filter(Boolean).map((e) => (typeof e === 'string' ? { value: e } : e));
        fields.push('emailAddresses');
    }

    const phoneList = phones ?? (phone !== undefined ? [phone] : undefined);
    if (phoneList !== undefined) {
        payload.phoneNumbers = phoneList.filter(Boolean).map((p) => (typeof p === 'string' ? { value: p } : p));
        fields.push('phoneNumbers');
    }

    if (organization !== undefined || title !== undefined) {
        payload.organizations = [{ ...(organization ? { name: organization } : {}), ...(title ? { title } : {}) }];
        fields.push('organizations');
    }

    if (notes !== undefined) {
        payload.biographies = [{ value: notes, contentType: 'TEXT_PLAIN' }];
        fields.push('biographies');
    }

    return { payload, fields };
}

const contacts = {
    async find(query, { pageSize = 20, readMask = 'names,emailAddresses,phoneNumbers,organizations,biographies' } = {}) {
        if (!query || !String(query).trim()) throw new Error('Search query is required.');
        const qs = toQueryString({ query: String(query).trim(), pageSize, readMask });
        const data = await fetchAPI(`${PEOPLE_BASE}/people:searchContacts${qs}`);
        return (data?.results || []).map((r) => r.person).filter(Boolean);
    },

    async list({ pageSize = 50, pageToken, personFields = 'names,emailAddresses,phoneNumbers,organizations' } = {}) {
        const qs = toQueryString({ pageSize, pageToken, personFields });
        const data = await fetchAPI(`${PEOPLE_BASE}/people/me/connections${qs}`);
        return {
            connections: data?.connections || [],
            nextPageToken: data?.nextPageToken || null,
            totalItems: data?.totalItems ?? (data?.connections?.length || 0)
        };
    },

    async get(resourceName, { personFields = 'names,emailAddresses,phoneNumbers,organizations,biographies,addresses' } = {}) {
        const resource = normalizePersonResource(resourceName);
        const qs = toQueryString({ personFields });
        return fetchAPI(`${PEOPLE_BASE}/${resource}${qs}`);
    },

    async create(input = {}) {
        const { payload } = buildPersonPayload(input);
        if (Object.keys(payload).length === 0) {
            throw new Error('Provide at least a name, email, or phone number to create a contact.');
        }
        return fetchAPI(`${PEOPLE_BASE}/people:createContact`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    },

    async update(resourceName, patch = {}) {
        const resource = normalizePersonResource(resourceName);
        const { payload, fields } = buildPersonPayload(patch);
        if (fields.length === 0) {
            throw new Error('No updatable contact fields provided.');
        }
        const existing = await contacts.get(resource, { personFields: 'metadata' });
        payload.etag = existing.etag;
        const qs = toQueryString({ updatePersonFields: fields.join(',') });
        return fetchAPI(`${PEOPLE_BASE}/${resource}:updateContact${qs}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
        });
    },

    async delete(resourceName) {
        const resource = normalizePersonResource(resourceName);
        await fetchAPI(`${PEOPLE_BASE}/${resource}:deleteContact`, { method: 'DELETE' });
        return { resourceName: resource, deleted: true };
    },

    async listLabels({ pageSize = 100, groupFields = 'name,groupType,memberCount' } = {}) {
        const qs = toQueryString({ pageSize, groupFields });
        const data = await fetchAPI(`${PEOPLE_BASE}/contactGroups${qs}`);
        return data?.contactGroups || [];
    },

    async addLabel(labelResourceName, contactResourceNames) {
        return modifyContactLabel(labelResourceName, contactResourceNames, 'resourceNamesToAdd');
    },

    async removeLabel(labelResourceName, contactResourceNames) {
        return modifyContactLabel(labelResourceName, contactResourceNames, 'resourceNamesToRemove');
    }
};

function modifyContactLabel(labelResourceName, contactResourceNames, field) {
    if (!labelResourceName) throw new Error('labelResourceName is required.');
    const group = labelResourceName.startsWith('contactGroups/') ? labelResourceName : `contactGroups/${labelResourceName}`;
    const list = (Array.isArray(contactResourceNames) ? contactResourceNames : [contactResourceNames])
        .filter(Boolean)
        .map(normalizePersonResource);
    if (list.length === 0) throw new Error('At least one contact resourceName is required.');
    return fetchAPI(`${PEOPLE_BASE}/${group}/members:modify`, {
        method: 'POST',
        body: JSON.stringify({ [field]: list })
    });
}

// --- Google Tasks API v1 CRUD ---
function normalizeTaskDue(due) {
    if (!due) return undefined;
    const str = String(due).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return `${str}T00:00:00.000Z`;
    return toISODateTime(str);
}

const tasks = {
    async listLists({ maxResults = 50 } = {}) {
        const qs = toQueryString({ maxResults });
        const data = await fetchAPI(`${TASKS_BASE}/users/@me/lists${qs}`);
        return data?.items || [];
    },

    async createList(title) {
        if (!title || !String(title).trim()) throw new Error('Task list title is required.');
        return fetchAPI(`${TASKS_BASE}/users/@me/lists`, {
            method: 'POST',
            body: JSON.stringify({ title: String(title).trim() })
        });
    },

    async list(taskListId = '@default', { showCompleted = true, showHidden = false, dueMin, dueMax, maxResults = 100 } = {}) {
        const qs = toQueryString({
            showCompleted,
            showHidden,
            dueMin: normalizeTaskDue(dueMin),
            dueMax: normalizeTaskDue(dueMax),
            maxResults
        });
        const data = await fetchAPI(`${TASKS_BASE}/lists/${encodeURIComponent(taskListId)}/tasks${qs}`);
        return data?.items || [];
    },

    async find(query, taskListId = '@default', options = {}) {
        const words = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (words.length === 0) throw new Error('Search query is required.');
        const items = await tasks.list(taskListId, options);
        return items.filter((item) => {
            const title = (item.title || '').toLowerCase();
            return words.every((word) => title.includes(word));
        });
    },

    async get(taskId, taskListId = '@default') {
        if (!taskId) throw new Error('taskId is required.');
        return fetchAPI(`${TASKS_BASE}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`);
    },

    async create({ title, notes, due, status = 'needsAction', parent, previous, predecessor } = {}, taskListId = '@default') {
        if (!title || !String(title).trim()) throw new Error('Task title is required.');
        const payload = { title: String(title).trim(), status };
        if (notes !== undefined) payload.notes = notes;
        if (due !== undefined) payload.due = normalizeTaskDue(due);
        const qs = toQueryString({ parent, previous: predecessor ?? previous });
        return fetchAPI(`${TASKS_BASE}/lists/${encodeURIComponent(taskListId)}/tasks${qs}`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    },

    async update(taskId, patch = {}, taskListId = '@default') {
        if (!taskId) throw new Error('taskId is required.');
        const body = { ...patch };
        if (patch.due !== undefined) {
            body.due = patch.due === null ? null : normalizeTaskDue(patch.due);
        }
        return fetchAPI(`${TASKS_BASE}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`, {
            method: 'PATCH',
            body: JSON.stringify(body)
        });
    },

    async complete(taskId, taskListId = '@default') {
        return tasks.update(taskId, { status: 'completed', completed: new Date().toISOString() }, taskListId);
    },

    async move(taskId, { parent, previous, predecessor, destinationTasklist } = {}, taskListId = '@default') {
        if (!taskId) throw new Error('taskId is required.');
        const qs = toQueryString({ parent, previous: predecessor ?? previous, destinationTasklist });
        return fetchAPI(`${TASKS_BASE}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}/move${qs}`, {
            method: 'POST'
        });
    },

    async delete(taskId, taskListId = '@default') {
        if (!taskId) throw new Error('taskId is required.');
        await fetchAPI(`${TASKS_BASE}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`, {
            method: 'DELETE'
        });
        return { id: taskId, taskListId, deleted: true };
    }
};

// --- Human-in-the-Loop Approval Dialog ---
const DIALOG_ID = 'gtools-approval-dialog';
const STYLE_ID = 'gtools-approval-styles';

const DEFAULT_APPROVAL_CSS = `
    #${DIALOG_ID} { border: 1px solid #e5e7eb; border-radius: 0.75rem; padding: 0; max-width: 58rem; width: calc(100vw - 2rem); box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.15), 0 8px 10px -6px rgb(0 0 0 / 0.1); font-family: system-ui, -apple-system, sans-serif; color: #111827; background: #ffffff; margin: auto; }
    #${DIALOG_ID}:modal { overscroll-behavior: contain; }
    #${DIALOG_ID}::backdrop { background: rgb(15 23 42 / 0.55); backdrop-filter: blur(2px); overflow: hidden; overscroll-behavior: contain; }
    #${DIALOG_ID} .gt-header { padding: 1rem 1.25rem; border-bottom: 1px solid #f3f4f6; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
    #${DIALOG_ID} .gt-header-left { display: flex; align-items: center; gap: 0.625rem; }
    #${DIALOG_ID} .gt-count { font-size: 0.75rem; color: #6b7280; font-weight: 500; }
    #${DIALOG_ID} .gt-badge { display: inline-block; font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 0.15rem 0.5rem; border-radius: 9999px; white-space: nowrap; }
    #${DIALOG_ID} .gt-badge-create { background: #dbeafe; color: #1d4ed8; }
    #${DIALOG_ID} .gt-badge-update { background: #fef3c7; color: #b45309; }
    #${DIALOG_ID} .gt-badge-delete { background: #fee2e2; color: #b91c1c; }
    #${DIALOG_ID} .gt-title { margin: 0; font-size: 1rem; font-weight: 600; }
    #${DIALOG_ID} .gt-body { padding: 0.75rem 1.25rem; font-size: 0.875rem; line-height: 1.45; max-height: 60vh; overflow: auto; }
    #${DIALOG_ID} .gt-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
    #${DIALOG_ID} .gt-table th { text-align: left; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; padding: 0.5rem 0.625rem; border-bottom: 1px solid #e5e7eb; background: #f9fafb; position: sticky; top: 0; }
    #${DIALOG_ID} .gt-table td { padding: 0.625rem; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
    #${DIALOG_ID} .gt-table tr:last-child td { border-bottom: none; }
    #${DIALOG_ID} .gt-table tr.gt-row-unchecked td { opacity: 0.5; }
    #${DIALOG_ID} .gt-tool-name { font-weight: 600; color: #1f2937; white-space: nowrap; }
    #${DIALOG_ID} .gt-kv-list { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 0.2rem 0.5rem; font-size: 0.75rem; }
    #${DIALOG_ID} .gt-kv-list dt { color: #6b7280; font-weight: 500; }
    #${DIALOG_ID} .gt-kv-list dd { margin: 0; color: #111827; word-break: break-word; }
    #${DIALOG_ID} .gt-actions { padding: 0.875rem 1.25rem; border-top: 1px solid #f3f4f6; display: flex; justify-content: flex-end; gap: 0.625rem; background: #f9fafb; }
    #${DIALOG_ID} button { font: inherit; font-size: 0.875rem; font-weight: 500; padding: 0.5rem 1rem; border-radius: 0.5rem; cursor: pointer; border: 1px solid transparent; }
    #${DIALOG_ID} .gt-btn-cancel { background: #ffffff; border-color: #d1d5db; color: #374151; }
    #${DIALOG_ID} .gt-btn-cancel:hover { background: #f3f4f6; }
    #${DIALOG_ID} .gt-btn-approve { background: #2563eb; color: #ffffff; }
    #${DIALOG_ID} .gt-btn-approve:hover:not(:disabled) { background: #1d4ed8; }
    #${DIALOG_ID} .gt-btn-approve:disabled { opacity: 0.5; cursor: not-allowed; }
    #${DIALOG_ID} .gt-btn-delete { background: #dc2626; color: #ffffff; }
    #${DIALOG_ID} .gt-btn-delete:hover:not(:disabled) { background: #b91c1c; }
`;

function getCssCandidateUrls(baseUrl = import.meta.url) {
    return [
        new URL('./gTools.css', baseUrl).href,
        new URL('../css/gTools.css', baseUrl).href,
        new URL('../gTools.css', baseUrl).href
    ];
}

let stylesLoadPromise = null;

async function ensureApprovalStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    if (stylesLoadPromise) return stylesLoadPromise;

    stylesLoadPromise = (async () => {
        if (typeof fetch === 'function') {
            for (const url of getCssCandidateUrls()) {
                try {
                    const res = await fetch(url, { cache: 'no-cache' });
                    const contentType = res.headers?.get?.('content-type') || '';
                    if (res.ok && !contentType.includes('text/html')) {
                        const link = document.createElement('link');
                        link.id = STYLE_ID;
                        link.rel = 'stylesheet';
                        link.href = url;
                        await new Promise((resolve) => {
                            link.onload = resolve;
                            link.onerror = resolve;
                            document.head.appendChild(link);
                        });
                        return;
                    }
                } catch {
                    // Try next candidate path.
                }
            }
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = DEFAULT_APPROVAL_CSS;
        document.head.appendChild(style);
    })();

    return stylesLoadPromise;
}

let approvalQueue = Promise.resolve();

function flattenDetails(objValue, prefix = '') {
    const entries = [];
    if (!objValue || typeof objValue !== 'object') return entries;
    for (const [key, val] of Object.entries(objValue)) {
        if (val === undefined) continue;
        const label = prefix ? `${prefix}.${key}` : key;
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            entries.push(...flattenDetails(val, label));
        } else if (Array.isArray(val)) {
            entries.push([label, val.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ')]);
        } else {
            entries.push([label, val === null ? 'null' : String(val)]);
        }
    }
    return entries;
}

function formatToolLabel(toolName = '') {
    return String(toolName)
        .replace(/^google_/, '')
        .split('_')
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
        .join(' ');
}

function confirmBatch(items = []) {
    if (!Array.isArray(items) || items.length === 0) return Promise.resolve([]);

    const run = approvalQueue.then(async () => {
        if (typeof document === 'undefined' || typeof HTMLDialogElement === 'undefined') {
            return Promise.reject(new Error(`Approval dialog unavailable for ${items[0].toolName}.`));
        }
        await ensureApprovalStyles();

        let dialog = document.getElementById(DIALOG_ID);
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = DIALOG_ID;
            dialog.setAttribute('aria-labelledby', `${DIALOG_ID}-title`);
            dialog.innerHTML = `
                <div class="gt-header">
                    <div class="gt-header-left">
                        <span class="gt-badge" data-role="badge"></span>
                        <h2 class="gt-title" id="${DIALOG_ID}-title"></h2>
                    </div>
                    <span class="gt-count" data-role="count"></span>
                </div>
                <div class="gt-body">
                    <table class="gt-table">
                        <thead>
                            <tr>
                                <th><input type="checkbox" data-role="select-all" aria-label="Select all actions" checked></th>
                                <th>Action</th>
                                <th>Tool</th>
                                <th>Summary</th>
                                <th>Details</th>
                            </tr>
                        </thead>
                        <tbody data-role="tbody"></tbody>
                    </table>
                </div>
                <form method="dialog" class="gt-actions">
                    <button type="submit" value="cancel" class="gt-btn-cancel" autofocus>Reject All</button>
                    <button type="submit" value="approve" class="gt-btn-approve" data-role="approve">Approve Selected</button>
                </form>
            `;
            document.body.appendChild(dialog);
        }

        const badgeEl = dialog.querySelector('[data-role="badge"]');
        const titleEl = dialog.querySelector(`#${DIALOG_ID}-title`);
        const countEl = dialog.querySelector('[data-role="count"]');
        const tbody = dialog.querySelector('[data-role="tbody"]');
        const selectAll = dialog.querySelector('[data-role="select-all"]');
        const approveBtn = dialog.querySelector('[data-role="approve"]');

        const hasDelete = items.some((it) => it.actionType === 'delete');
        const allSameKind = items.every((it) => it.actionType === items[0].actionType);
        const headerKind = allSameKind ? (items[0].actionType === 'delete' ? 'delete' : items[0].actionType === 'create' ? 'create' : 'update') : (hasDelete ? 'delete' : 'update');

        badgeEl.className = `gt-badge gt-badge-${headerKind}`;
        badgeEl.textContent = items.length === 1 ? headerKind.toUpperCase() : 'BATCH';
        titleEl.textContent = items.length === 1 ? (items[0].title || 'Approve Agent Action') : `Review ${items.length} Agent Actions`;
        countEl.textContent = `${items.length} pending`;

        tbody.replaceChildren();
        const rowCheckboxes = [];

        items.forEach((item, index) => {
            const kind = item.actionType === 'delete' ? 'delete' : item.actionType === 'create' ? 'create' : 'update';
            const tr = document.createElement('tr');

            const tdCheck = document.createElement('td');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = true;
            cb.setAttribute('aria-label', `Approve ${item.toolName}`);
            tdCheck.appendChild(cb);

            const tdAction = document.createElement('td');
            const badge = document.createElement('span');
            badge.className = `gt-badge gt-badge-${kind}`;
            badge.textContent = kind.toUpperCase();
            tdAction.appendChild(badge);

            const tdTool = document.createElement('td');
            tdTool.className = 'gt-tool-name';
            tdTool.textContent = formatToolLabel(item.toolName);

            const tdSummary = document.createElement('td');
            tdSummary.textContent = item.summary || `Run ${item.toolName}`;

            const tdDetails = document.createElement('td');
            const entries = flattenDetails(item.details);
            if (entries.length > 0) {
                const dl = document.createElement('dl');
                dl.className = 'gt-kv-list';
                for (const [k, v] of entries) {
                    const dt = document.createElement('dt');
                    dt.textContent = k;
                    const dd = document.createElement('dd');
                    dd.textContent = v;
                    dl.append(dt, dd);
                }
                tdDetails.appendChild(dl);
            } else {
                tdDetails.textContent = '—';
            }

            tr.append(tdCheck, tdAction, tdTool, tdSummary, tdDetails);
            tbody.appendChild(tr);
            rowCheckboxes.push({ cb, tr, index });
        });

        const syncSelectionUI = () => {
            const selectedCount = rowCheckboxes.filter((r) => r.cb.checked).length;
            selectAll.checked = selectedCount === items.length;
            selectAll.indeterminate = selectedCount > 0 && selectedCount < items.length;
            approveBtn.disabled = selectedCount === 0;
            approveBtn.textContent = items.length === 1
                ? (hasDelete ? 'Approve Delete' : 'Approve & Run')
                : `Approve Selected (${selectedCount})`;
            approveBtn.className = hasDelete && selectedCount > 0 ? 'gt-btn-delete' : 'gt-btn-approve';
            for (const r of rowCheckboxes) {
                r.tr.classList.toggle('gt-row-unchecked', !r.cb.checked);
            }
        };

        selectAll.onchange = () => {
            for (const r of rowCheckboxes) r.cb.checked = selectAll.checked;
            syncSelectionUI();
        };
        for (const r of rowCheckboxes) {
            r.cb.onchange = syncSelectionUI;
        }
        syncSelectionUI();

        return new Promise((resolve) => {
            const onClose = () => {
                const approved = dialog.returnValue === 'approve';
                dialog.returnValue = '';
                dialog.removeEventListener('close', onClose);
                resolve(rowCheckboxes.map((r) => approved && r.cb.checked));
            };
            dialog.addEventListener('close', onClose);
            dialog.showModal();
        });
    });

    approvalQueue = run.catch(() => items.map(() => false));
    return run;
}

function confirmAction(item = {}) {
    return confirmBatch([item]).then(([approved]) => Boolean(approved));
}

function createBatchApprover({ windowMs = 2000, promptBatch = confirmBatch } = {}) {
    let pending = [];
    let timer = null;

    const flush = async () => {
        timer = null;
        const batch = pending;
        pending = [];
        if (batch.length === 0) return;
        try {
            const results = await promptBatch(batch.map((entry) => entry.item));
            batch.forEach((entry, idx) => entry.resolve(Boolean(results?.[idx])));
        } catch (err) {
            batch.forEach((entry) => entry.reject(err));
        }
    };

    return (item) => new Promise((resolve, reject) => {
        pending.push({ item, resolve, reject });
        if (timer !== null) clearTimeout(timer);
        if (windowMs <= 0) {
            flush();
        } else {
            timer = setTimeout(flush, windowMs);
        }
    });
}

// --- UTCP / Agent Tool Definitions ---
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string' };
const reqStr = { type: 'string', minLength: 1 };
const bool = { type: 'boolean' };
const int = { type: 'integer', minimum: 1 };
const strArr = { type: 'array', items: str };

const TOOL_SPECS = [
    // Calendar
    {
        name: 'google_calendar_get_events',
        description: 'Get Google Calendar events for a date range or search query.',
        readOnly: true,
        parameters: obj({ start: str, end: str, query: str, calendarId: str, maxResults: int }),
        run: (a) => calendar.getEvents(a)
    },
    {
        name: 'google_calendar_get_day_events',
        description: 'Get all Google Calendar events for a specific day (defaults to today).',
        readOnly: true,
        parameters: obj({ date: str, calendarId: str }),
        run: (a) => calendar.getDayEvents(a.date || new Date(), { calendarId: a.calendarId || 'primary' })
    },
    {
        name: 'google_calendar_get_colors',
        description: 'Get the canonical Google Calendar colorId palette (event and calendar background/foreground hex colors).',
        readOnly: true,
        requiresApproval: false,
        parameters: obj(),
        run: () => calendar.getColors()
    },
    {
        name: 'google_calendar_new_event',
        description: 'Create a new Google Calendar event. Requires user approval.',
        readOnly: false,
        actionType: 'create',
        summarize: (a) => `Create calendar event "${a.summary}"${a.start ? ` starting ${a.start}` : ''}.`,
        parameters: obj({
            summary: reqStr,
            description: str,
            location: str,
            start: str,
            end: str,
            allDay: bool,
            attendees: strArr,
            timeZone: str,
            calendarId: str
        }, ['summary']),
        run: (a) => calendar.newEvent(a)
    },
    {
        name: 'google_calendar_new_scheduled_task',
        description: 'Schedule a task onto Google Calendar as a time-blocked ScheduledTask event (distinct from a Google Task with only a target date). Requires user approval.',
        readOnly: false,
        requiresApproval: true,
        actionType: 'create',
        summarize: (a) => `Schedule task "${a.title}" on Calendar${a.start ? ` at ${a.start}` : ''}.`,
        parameters: obj({
            title: reqStr,
            notes: str,
            start: str,
            end: str,
            durationMinutes: int,
            taskId: str,
            taskListId: str,
            colorId: str,
            timeZone: str,
            calendarId: str
        }, ['title']),
        run: (a) => calendar.newScheduledTask(a)
    },
    {
        name: 'google_calendar_update_event',
        description: 'Update an existing Google Calendar event by ID (title, description, location, times, attendees, colorId, visibility, status, recurrence). Requires user approval.',
        readOnly: false,
        actionType: 'update',
        summarize: (a) => `Update calendar event "${a.eventId}".`,
        parameters: obj({
            eventId: reqStr,
            calendarId: str,
            patch: obj({
                summary: str,
                description: str,
                location: str,
                start: str,
                end: str,
                attendees: strArr,
                colorId: str,
                visibility: { enum: ['default', 'public', 'private', 'confidential'] },
                status: { enum: ['confirmed', 'tentative', 'cancelled'] },
                recurrence: strArr,
                timeZone: str
            })
        }, ['eventId', 'patch']),
        run: (a) => calendar.updateEvent(a.eventId, a.patch, a.calendarId || 'primary')
    },
    {
        name: 'google_calendar_delete_event',
        description: 'Delete a Google Calendar event by ID. Requires user approval.',
        readOnly: false,
        actionType: 'delete',
        summarize: (a) => `Permanently delete calendar event "${a.eventId}".`,
        parameters: obj({ eventId: reqStr, calendarId: str }, ['eventId']),
        run: (a) => calendar.deleteEvent(a.eventId, a.calendarId || 'primary')
    },

    // Contacts
    {
        name: 'google_contacts_find',
        description: 'Search Google Contacts by name, email, or phone number.',
        readOnly: true,
        parameters: obj({ query: reqStr, pageSize: int }, ['query']),
        run: (a) => contacts.find(a.query, { pageSize: a.pageSize })
    },
    {
        name: 'google_contacts_list',
        description: 'List Google Contacts.',
        readOnly: true,
        parameters: obj({ pageSize: int, pageToken: str }),
        run: (a) => contacts.list(a)
    },
    {
        name: 'google_contacts_create',
        description: 'Create a new Google Contact.',
        readOnly: false,
        requiresApproval: false,
        actionType: 'create',
        summarize: (a) => `Create contact "${a.displayName || [a.givenName, a.familyName].filter(Boolean).join(' ') || a.email || a.phone}".`,
        parameters: obj({
            givenName: str,
            familyName: str,
            displayName: str,
            email: str,
            phone: str,
            organization: str,
            title: str,
            notes: str
        }),
        run: (a) => contacts.create(a)
    },
    {
        name: 'google_contacts_update',
        description: 'Update an existing Google Contact by resourceName. Requires user approval.',
        readOnly: false,
        requiresApproval: true,
        actionType: 'update',
        summarize: (a) => `Update contact "${a.resourceName}".`,
        parameters: obj({
            resourceName: reqStr,
            patch: obj({
                givenName: str,
                familyName: str,
                displayName: str,
                email: str,
                phone: str,
                organization: str,
                title: str,
                notes: str
            })
        }, ['resourceName', 'patch']),
        run: (a) => contacts.update(a.resourceName, a.patch)
    },
    {
        name: 'google_contacts_delete',
        description: 'Delete a Google Contact by resourceName. Requires user approval.',
        readOnly: false,
        requiresApproval: true,
        actionType: 'delete',
        summarize: (a) => `Permanently delete contact "${a.resourceName}".`,
        parameters: obj({ resourceName: reqStr }, ['resourceName']),
        run: (a) => contacts.delete(a.resourceName)
    },
    {
        name: 'google_contacts_get_labels',
        description: 'Get Google Contact labels (contact groups).',
        readOnly: true,
        requiresApproval: false,
        parameters: obj({ pageSize: int }),
        run: (a) => contacts.listLabels(a)
    },
    {
        name: 'google_contacts_add_label',
        description: 'Attach a Google Contact label (contactGroup) to one or more contacts.',
        readOnly: false,
        requiresApproval: false,
        actionType: 'update',
        summarize: (a) => `Attach label "${a.labelResourceName}" to contact(s).`,
        parameters: obj({
            labelResourceName: reqStr,
            contactResourceNames: strArr
        }, ['labelResourceName', 'contactResourceNames']),
        run: (a) => contacts.addLabel(a.labelResourceName, a.contactResourceNames)
    },
    {
        name: 'google_contacts_remove_label',
        description: 'Remove a Google Contact label (contactGroup) association from one or more contacts. Requires user approval.',
        readOnly: false,
        requiresApproval: true,
        actionType: 'update',
        summarize: (a) => `Remove label "${a.labelResourceName}" from ${a.contactResourceNames.length} contact(s).`,
        parameters: obj({
            labelResourceName: reqStr,
            contactResourceNames: strArr
        }, ['labelResourceName', 'contactResourceNames']),
        run: (a) => contacts.removeLabel(a.labelResourceName, a.contactResourceNames)
    },

    // Tasks
    {
        name: 'google_tasks_list_lists',
        description: 'List the user’s Google Task lists.',
        readOnly: true,
        parameters: obj({ maxResults: int }),
        run: (a) => tasks.listLists(a)
    },
    {
        name: 'google_tasks_list',
        description: 'List tasks in a Google Task list (defaults to @default).',
        readOnly: true,
        parameters: obj({ taskListId: str, showCompleted: bool, dueMin: str, dueMax: str, maxResults: int }),
        run: (a) => tasks.list(a.taskListId || '@default', a)
    },
    {
        name: 'google_tasks_find',
        description: 'Find Google Tasks whose titles contain all submitted search words.',
        readOnly: true,
        parameters: obj({ query: reqStr, taskListId: str, showCompleted: bool, maxResults: int }, ['query']),
        run: (a) => tasks.find(a.query, a.taskListId || '@default', a)
    },
    {
        name: 'google_tasks_create_list',
        description: 'Create a new Google Tasks list. Requires user approval.',
        readOnly: false,
        actionType: 'create',
        summarize: (a) => `Create Google Tasks list "${a.title}".`,
        parameters: obj({ title: reqStr }, ['title']),
        run: (a) => tasks.createList(a.title)
    },
    {
        name: 'google_tasks_create',
        description: 'Create a new Google Task. Requires user approval.',
        readOnly: false,
        actionType: 'create',
        summarize: (a) => `Create Google Task "${a.title}"${a.due ? ` (due ${a.due})` : ''}.`,
        parameters: obj({
            title: reqStr,
            notes: str,
            due: str,
            taskListId: str,
            parent: str
        }, ['title']),
        run: (a) => tasks.create(a, a.taskListId || '@default')
    },
    {
        name: 'google_tasks_update',
        description: 'Update an existing Google Task by ID. Requires user approval.',
        readOnly: false,
        actionType: 'update',
        summarize: (a) => `Update Google Task "${a.taskId}".`,
        parameters: obj({
            taskId: reqStr,
            taskListId: str,
            patch: obj({
                title: str,
                notes: str,
                due: { type: ['string', 'null'] },
                status: { enum: ['needsAction', 'completed'] }
            })
        }, ['taskId', 'patch']),
        run: (a) => tasks.update(a.taskId, a.patch, a.taskListId || '@default')
    },
    {
        name: 'google_tasks_complete',
        description: 'Mark a Google Task as completed. Requires user approval.',
        readOnly: false,
        actionType: 'update',
        summarize: (a) => `Mark Google Task "${a.taskId}" as completed.`,
        parameters: obj({ taskId: reqStr, taskListId: str }, ['taskId']),
        run: (a) => tasks.complete(a.taskId, a.taskListId || '@default')
    },
    {
        name: 'google_tasks_move',
        description: 'Move an existing Google Task under a parent task (making it a subtask), promote it to top-level (omit parent), reorder it immediately after a predecessor sibling task ID (omit predecessor to place first), or move to another list. Requires user approval.',
        readOnly: false,
        requiresApproval: true,
        actionType: 'update',
        summarize: (a) => a.parent
            ? `Make task "${a.taskId}" a subtask of "${a.parent}".`
            : `Move task "${a.taskId}"${a.destinationTasklist ? ` to list "${a.destinationTasklist}"` : ' to top-level'}.`,
        parameters: obj({
            taskId: reqStr,
            taskListId: str,
            parent: str,
            predecessor: str,
            destinationTasklist: str
        }, ['taskId']),
        run: (a) => tasks.move(a.taskId, { parent: a.parent, predecessor: a.predecessor, destinationTasklist: a.destinationTasklist }, a.taskListId || '@default')
    },
    {
        name: 'google_tasks_delete',
        description: 'Delete a Google Task by ID. Requires user approval.',
        readOnly: false,
        actionType: 'delete',
        summarize: (a) => `Permanently delete Google Task "${a.taskId}".`,
        parameters: obj({ taskId: reqStr, taskListId: str }, ['taskId']),
        run: (a) => tasks.delete(a.taskId, a.taskListId || '@default')
    }
];

function getAgentTools({ requireApproval = true, batchWindowMs = 2000, confirm, promptBatch, onBeforeExecute, onAfterExecute } = {}) {
    const requestApproval = confirm || createBatchApprover({
        windowMs: batchWindowMs,
        promptBatch: promptBatch || confirmBatch
    });

    return TOOL_SPECS.map((spec) => {
        const destructive = spec.actionType === 'delete';
        const needsApproval = spec.requiresApproval ?? !spec.readOnly;
        const execute = async (args = {}) => {
            if (needsApproval && requireApproval) {
                const approved = await requestApproval({
                    toolName: spec.name,
                    title: destructive ? 'Confirm Deletion' : 'Approve Google Action',
                    summary: spec.summarize ? spec.summarize(args) : spec.description,
                    actionType: spec.actionType || 'update',
                    details: args
                });
                if (!approved) {
                    throw new Error(`User rejected ${spec.name}.`);
                }
            }
            onBeforeExecute?.(spec.name, args);
            const result = await spec.run(args);
            onAfterExecute?.(spec.name, args, result);
            return result;
        };

        return {
            name: spec.name,
            description: spec.description,
            parameters: spec.parameters,
            inputSchema: spec.parameters,
            signature: spec.parameters,
            annotations: { readOnly: spec.readOnly, destructive, requiresApproval: needsApproval },
            effect: spec.readOnly ? 'none' : 'unsafe',
            execute,
            handler: execute
        };
    });
}

function registerWith(registry, options = {}) {
    if (!registry || typeof registry.register !== 'function') {
        throw new TypeError('Expected a tool registry with a register(definition, execute) method.');
    }
    const existing = new Set((registry.list?.() || []).map((t) => t.name));
    const tools = getAgentTools(options);
    for (const tool of tools) {
        if (existing.has(tool.name)) continue;
        registry.register({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            annotations: tool.annotations
        }, tool.execute);
    }
    return tools;
}

export const gTools = Object.freeze({
    auth,
    calendar,
    contacts,
    tasks,
    fetchAPI,
    confirmAction,
    confirmBatch,
    createBatchApprover,
    getCssCandidateUrls,
    getAgentTools,
    registerWith
});

if (typeof globalThis !== 'undefined') {
    globalThis.gTools = gTools;
}

export default gTools;
