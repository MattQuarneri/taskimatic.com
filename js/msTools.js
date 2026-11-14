/**
 * Standalone Microsoft Graph Tools (Calendar, Contacts, To Do Tasks) with
 * self-contained IndexedDB OAuth storage, backup export/import,
 * UTCP/JSON-Schema agent tool definitions, and human-in-the-loop approval.
 */

import { Calendar } from './calendarUI.js';
import { gTools } from './gTools.js';

const DB_NAME = 'AgentStorage';
const STORE_NAME = 'credentials';
const TOKEN_KEY = 'ms_graph_token';
const CLIENT_ID_KEY = 'ms_graph_client_id';
const TENANT_ID_KEY = 'ms_graph_tenant_id';
const BACKUP_FORMAT = 'taskimatic-microsoft-oauth';

export const DEFAULT_MS_SCOPES = Object.freeze([
    'Calendars.ReadWrite',
    'Contacts.ReadWrite',
    'Tasks.ReadWrite'
]);

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

let idbQueue = Promise.resolve();

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
    return idbQueue.then(async () => {
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
    const op = idbQueue.then(async () => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put({ ...record, savedAt: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted.'));
        }).finally(() => db.close());
    });
    idbQueue = op.catch(() => {});
    return op;
}

function idbDelete(id) {
    const op = idbQueue.then(async () => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('IndexedDB delete aborted.'));
        }).finally(() => db.close());
    });
    idbQueue = op.catch(() => {});
    return op;
}

// --- PKCE Helpers for Standalone Browser OAuth ---
function base64UrlEncode(bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createPkcePair() {
    const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
    const verifier = base64UrlEncode(verifierBytes);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = base64UrlEncode(new Uint8Array(digest));
    return { verifier, challenge };
}

// --- Auth & Credentials ---
const auth = {
    DEFAULT_SCOPES: DEFAULT_MS_SCOPES,

    async getClientId() {
        return (await idbGet(CLIENT_ID_KEY))?.clientId || '';
    },

    async setClientId(clientId) {
        const trimmed = typeof clientId === 'string' ? clientId.trim() : '';
        await idbPut({ id: CLIENT_ID_KEY, clientId: trimmed });
        return trimmed;
    },

    async getTenantId() {
        return (await idbGet(TENANT_ID_KEY))?.tenantId || 'common';
    },

    async setTenantId(tenantId) {
        const trimmed = typeof tenantId === 'string' && tenantId.trim() ? tenantId.trim() : 'common';
        await idbPut({ id: TENANT_ID_KEY, tenantId: trimmed });
        return trimmed;
    },

    async getToken() {
        return (await idbGet(TOKEN_KEY))?.token || null;
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
        if (!record?.token) return { authenticated: false, expired: false, expiresAt: null };
        const expired = Boolean(record.expiresAt && Date.now() >= record.expiresAt - 30_000);
        return { authenticated: !expired, expired, expiresAt: record.expiresAt || null };
    },

    async isAuthenticated() {
        return (await auth.getStatus()).authenticated;
    },

    async connect({ clientId, tenantId, scopes = DEFAULT_MS_SCOPES, redirectUri = globalThis.location?.origin + globalThis.location?.pathname } = {}) {
        const resolvedClientId = (clientId ?? (await auth.getClientId())).trim();
        if (!resolvedClientId) throw new Error('Microsoft App (Client) ID is required before connecting.');
        if (clientId !== undefined) await auth.setClientId(resolvedClientId);

        const resolvedTenant = (tenantId ?? (await auth.getTenantId())).trim() || 'common';
        if (tenantId !== undefined) await auth.setTenantId(resolvedTenant);

        // Prefer MSAL.js if host page loaded it
        if (globalThis.msal?.PublicClientApplication) {
            const pca = new globalThis.msal.PublicClientApplication({
                auth: { clientId: resolvedClientId, authority: `https://login.microsoftonline.com/${resolvedTenant}`, redirectUri }
            });
            await pca.initialize?.();
            const res = await pca.loginPopup({ scopes: [...scopes] });
            const expiresIn = res.expiresOn ? Math.max(60, Math.floor((res.expiresOn.getTime() - Date.now()) / 1000)) : 3600;
            await auth.setToken(res.accessToken, expiresIn);
            return res;
        }

        // Standalone OAuth2 PKCE popup flow
        const { verifier, challenge } = await createPkcePair();
        const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
        const authUrl = new URL(`https://login.microsoftonline.com/${encodeURIComponent(resolvedTenant)}/oauth2/v2.0/authorize`);
        authUrl.searchParams.set('client_id', resolvedClientId);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_mode', 'query');
        authUrl.searchParams.set('scope', scopes.join(' '));
        authUrl.searchParams.set('code_challenge', challenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('state', state);

        const popup = globalThis.open?.(authUrl.href, 'ms_oauth_login', 'width=520,height=640');
        if (!popup) throw new Error('Popup blocked. Allow popups to sign in with Microsoft.');

        const code = await new Promise((resolve, reject) => {
            const timer = setInterval(() => {
                try {
                    if (popup.closed) {
                        clearInterval(timer);
                        reject(new Error('Microsoft authentication popup was closed.'));
                        return;
                    }
                    if (popup.location.origin === new URL(redirectUri).origin) {
                        const params = new URLSearchParams(popup.location.search);
                        if (params.get('error')) {
                            clearInterval(timer);
                            popup.close();
                            reject(new Error(params.get('error_description') || params.get('error')));
                            return;
                        }
                        const authCode = params.get('code');
                        if (authCode && params.get('state') === state) {
                            clearInterval(timer);
                            popup.close();
                            resolve(authCode);
                        }
                    }
                } catch {
                    // Cross-origin while user is on login.microsoftonline.com; keep polling.
                }
            }, 250);
        });

        const tokenRes = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(resolvedTenant)}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: resolvedClientId,
                scope: scopes.join(' '),
                code,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
                code_verifier: verifier
            })
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.access_token) {
            throw new Error(tokenData.error_description || tokenData.error || 'Microsoft token exchange failed.');
        }
        await auth.setToken(tokenData.access_token, tokenData.expires_in);
        return tokenData;
    },

    async exportBackup() {
        const record = await idbGet(TOKEN_KEY);
        if (!record?.token) throw new Error('No Microsoft credentials to export.');
        return {
            format: BACKUP_FORMAT,
            version: 1,
            clientId: await auth.getClientId(),
            tenantId: await auth.getTenantId(),
            accessToken: record.token,
            expiresAt: record.expiresAt || null,
            scopes: [...DEFAULT_MS_SCOPES],
            exportedAt: new Date().toISOString()
        };
    },

    async downloadBackup(filename = 'microsoft-tools-oauth.json') {
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
        if (!backup || backup.format !== BACKUP_FORMAT || typeof backup.clientId !== 'string' || typeof backup.accessToken !== 'string' || !backup.accessToken.trim()) {
            throw new Error('Please select a valid Microsoft OAuth export JSON file.');
        }
        const clientId = await auth.setClientId(backup.clientId);
        if (backup.tenantId) await auth.setTenantId(backup.tenantId);
        const remainingSeconds = backup.expiresAt ? Math.max(0, Math.floor((backup.expiresAt - Date.now()) / 1000)) : undefined;
        await auth.setToken(backup.accessToken, remainingSeconds);
        return { clientId, format: backup.format, importedAt: new Date().toISOString() };
    }
};

// --- Authenticated Microsoft Graph Helper ---
function notifyAuthExpired() {
    if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        globalThis.dispatchEvent(new CustomEvent('mstools:auth-expired'));
    }
}

async function fetchGraph(pathOrUrl, options = {}) {
    const status = await auth.getStatus();
    if (status.expired) {
        await auth.clearToken();
        notifyAuthExpired();
        throw new Error('Microsoft OAuth token expired. Please reconnect.');
    }
    const token = await auth.getToken();
    if (!token) throw new Error('Not authenticated with Microsoft. Please connect your Microsoft account first.');

    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${GRAPH_BASE}${pathOrUrl}`;
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
        throw new Error('Microsoft session expired or invalid. Please reconnect.');
    }
    if (!response.ok) {
        throw new Error(data?.error?.message || `Microsoft Graph request failed (${response.status})`);
    }
    return data;
}

function toQueryString(params = {}) {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') sp.set(key, String(value));
    }
    const qs = sp.toString();
    return qs ? `?${qs}` : '';
}

function toISODateTime(value) {
    if (!value) return undefined;
    if (value instanceof Date) return value.toISOString();
    const str = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(`${str}T00:00:00`).toISOString();
    const parsed = new Date(str);
    if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date/time value: ${value}`);
    return parsed.toISOString();
}

function localTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function normalizeGraphDateTime(dtObj) {
    if (!dtObj?.dateTime) return null;
    // Graph returns UTC or local without Z when Prefer header isn't set; ensure parseable ISO
    const iso = dtObj.timeZone === 'UTC' && !dtObj.dateTime.endsWith('Z')
        ? `${dtObj.dateTime}Z`
        : dtObj.dateTime;
    return { dateTime: iso, timeZone: dtObj.timeZone };
}

function normalizeGraphEvent(ev) {
    if (!ev) return ev;
    return {
        id: ev.id,
        summary: ev.subject || '',
        description: ev.bodyPreview || ev.body?.content || '',
        location: ev.location?.displayName || '',
        start: ev.isAllDay
            ? { date: ev.start?.dateTime?.slice(0, 10) }
            : normalizeGraphDateTime(ev.start),
        end: ev.isAllDay
            ? { date: ev.end?.dateTime?.slice(0, 10) }
            : normalizeGraphDateTime(ev.end),
        attendees: (ev.attendees || []).map((a) => ({ email: a.emailAddress?.address, name: a.emailAddress?.name })).filter((a) => a.email),
        colorId: ev.categories?.[0] || undefined,
        htmlLink: ev.webLink || '',
        raw: ev
    };
}

// --- Microsoft Calendar (/me/calendar) CRUD ---
const calendar = {
    async getEvents({ start, end, query, calendarId = 'primary', maxResults = 50 } = {}) {
        const base = calendarId && calendarId !== 'primary'
            ? `/me/calendars/${encodeURIComponent(calendarId)}`
            : '/me/calendar';
        const qs = toQueryString({
            startDateTime: toISODateTime(start),
            endDateTime: toISODateTime(end),
            $top: maxResults,
            $orderby: 'start/dateTime'
        });
        const path = start && end ? `${base}/calendarView${qs}` : `${base}/events${toQueryString({ $top: maxResults })}`;
        const data = await fetchGraph(path);
        let items = (data?.value || []).map(normalizeGraphEvent);
        if (query && String(query).trim()) {
            const q = String(query).trim().toLowerCase();
            items = items.filter((e) => e.summary.toLowerCase().includes(q) || e.description.toLowerCase().includes(q));
        }
        return items;
    },

    async getDayEvents(date = new Date(), options = {}) {
        const d = date instanceof Date ? date : new Date(date);
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
        const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
        return calendar.getEvents({ ...options, start, end });
    },

    async getTodayEvents(options = {}) {
        return calendar.getDayEvents(new Date(), options);
    },

    async getEvent(eventId, calendarId = 'primary') {
        if (!eventId) throw new Error('eventId is required.');
        const base = calendarId && calendarId !== 'primary'
            ? `/me/calendars/${encodeURIComponent(calendarId)}`
            : '/me/calendar';
        return normalizeGraphEvent(await fetchGraph(`${base}/events/${encodeURIComponent(eventId)}`));
    },

    async newEvent({ summary, description, location, start, end, allDay = false, attendees, colorId, timeZone = localTimeZone(), calendarId = 'primary' } = {}) {
        if (!summary) throw new Error('Event summary is required.');
        const startDate = start ? new Date(toISODateTime(start)) : new Date();
        const endDate = end ? new Date(toISODateTime(end)) : new Date(startDate.getTime() + 60 * 60 * 1000);

        const payload = {
            subject: summary,
            isAllDay: Boolean(allDay),
            start: { dateTime: startDate.toISOString(), timeZone: 'UTC' },
            end: { dateTime: endDate.toISOString(), timeZone: 'UTC' }
        };
        if (description !== undefined) payload.body = { contentType: 'text', content: description };
        if (location !== undefined) payload.location = { displayName: location };
        if (colorId !== undefined) payload.categories = [String(colorId)];
        if (Array.isArray(attendees) && attendees.length > 0) {
            payload.attendees = attendees.map((a) => ({
                emailAddress: { address: typeof a === 'string' ? a : a.email },
                type: 'required'
            }));
        }

        const base = calendarId && calendarId !== 'primary'
            ? `/me/calendars/${encodeURIComponent(calendarId)}`
            : '/me/calendar';
        return normalizeGraphEvent(await fetchGraph(`${base}/events`, {
            method: 'POST',
            body: JSON.stringify(payload)
        }));
    },

    async newScheduledTask({ title, notes, start, end, durationMinutes = 30, colorId, calendarId = 'primary', timeZone = localTimeZone() } = {}) {
        if (!title || !String(title).trim()) throw new Error('Scheduled task title is required.');
        const startDate = start ? new Date(toISODateTime(start)) : new Date();
        const endDate = end ? new Date(toISODateTime(end)) : new Date(startDate.getTime() + Number(durationMinutes) * 60 * 1000);
        return calendar.newEvent({
            summary: `☐ ${String(title).trim()}`,
            description: notes,
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            colorId,
            timeZone,
            calendarId
        });
    },

    async updateEvent(eventId, patch = {}, calendarId = 'primary') {
        if (!eventId) throw new Error('eventId is required.');
        const body = {};
        if (patch.summary !== undefined) body.subject = patch.summary;
        if (patch.description !== undefined) body.body = { contentType: 'text', content: patch.description };
        if (patch.location !== undefined) body.location = { displayName: patch.location };
        if (patch.start !== undefined) body.start = { dateTime: toISODateTime(patch.start), timeZone: 'UTC' };
        if (patch.end !== undefined) body.end = { dateTime: toISODateTime(patch.end), timeZone: 'UTC' };
        if (patch.colorId !== undefined) body.categories = patch.colorId ? [String(patch.colorId)] : [];
        if (Array.isArray(patch.attendees)) {
            body.attendees = patch.attendees.map((a) => ({
                emailAddress: { address: typeof a === 'string' ? a : a.email },
                type: 'required'
            }));
        }

        const base = calendarId && calendarId !== 'primary'
            ? `/me/calendars/${encodeURIComponent(calendarId)}`
            : '/me/calendar';
        return normalizeGraphEvent(await fetchGraph(`${base}/events/${encodeURIComponent(eventId)}`, {
            method: 'PATCH',
            body: JSON.stringify(body)
        }));
    },

    async deleteEvent(eventId, calendarId = 'primary') {
        if (!eventId) throw new Error('eventId is required.');
        const base = calendarId && calendarId !== 'primary'
            ? `/me/calendars/${encodeURIComponent(calendarId)}`
            : '/me/calendar';
        await fetchGraph(`${base}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
        return { id: eventId, calendarId, deleted: true };
    },

    async getColors() {
        return {
            event: {
                '1': { background: '#a4bdfc', foreground: '#1d1d1d' },
                '2': { background: '#7ae7bf', foreground: '#1d1d1d' },
                '3': { background: '#dbadff', foreground: '#1d1d1d' },
                '4': { background: '#ff887c', foreground: '#1d1d1d' },
                '5': { background: '#fbd75b', foreground: '#1d1d1d' },
                '6': { background: '#ffb878', foreground: '#1d1d1d' },
                '7': { background: '#46d6db', foreground: '#1d1d1d' },
                '8': { background: '#e1e1e1', foreground: '#1d1d1d' },
                '9': { background: '#5484ed', foreground: '#ffffff' },
                '10': { background: '#51b749', foreground: '#ffffff' },
                '11': { background: '#dc2127', foreground: '#ffffff' }
            }
        };
    },

    getUI(mode = 'day', { date = new Date(), calendarId = 'primary' } = {}) {
        return Calendar.connect(msTools, { mode, date, calendarId });
    }
};

// --- Microsoft Contacts (/me/contacts) CRUD ---
const contacts = {
    async find(query, { top = 20 } = {}) {
        if (!query || !String(query).trim()) throw new Error('Search query is required.');
        const qs = toQueryString({ $search: `"${String(query).trim()}"`, $top: top });
        const data = await fetchGraph(`/me/contacts${qs}`);
        return data?.value || [];
    },

    async list({ top = 50, skip = 0 } = {}) {
        const qs = toQueryString({ $top: top, $skip: skip });
        const data = await fetchGraph(`/me/contacts${qs}`);
        return { connections: data?.value || [], nextLink: data?.['@odata.nextLink'] || null };
    },

    async get(contactId) {
        if (!contactId) throw new Error('contactId is required.');
        return fetchGraph(`/me/contacts/${encodeURIComponent(contactId)}`);
    },

    async create({ givenName, familyName, displayName, email, phone, organization, title, notes } = {}) {
        const payload = {};
        if (displayName !== undefined) payload.displayName = displayName;
        if (givenName !== undefined) payload.givenName = givenName;
        if (familyName !== undefined) payload.surname = familyName;
        if (email !== undefined) payload.emailAddresses = [{ address: email, name: displayName || email }];
        if (phone !== undefined) payload.mobilePhone = phone;
        if (organization !== undefined) payload.companyName = organization;
        if (title !== undefined) payload.jobTitle = title;
        if (notes !== undefined) payload.personalNotes = notes;
        return fetchGraph('/me/contacts', { method: 'POST', body: JSON.stringify(payload) });
    },

    async update(contactId, patch = {}) {
        if (!contactId) throw new Error('contactId is required.');
        const body = {};
        if (patch.displayName !== undefined) body.displayName = patch.displayName;
        if (patch.givenName !== undefined) body.givenName = patch.givenName;
        if (patch.familyName !== undefined) body.surname = patch.familyName;
        if (patch.email !== undefined) body.emailAddresses = [{ address: patch.email }];
        if (patch.phone !== undefined) body.mobilePhone = patch.phone;
        if (patch.organization !== undefined) body.companyName = patch.organization;
        if (patch.title !== undefined) body.jobTitle = patch.title;
        if (patch.notes !== undefined) body.personalNotes = patch.notes;
        return fetchGraph(`/me/contacts/${encodeURIComponent(contactId)}`, {
            method: 'PATCH',
            body: JSON.stringify(body)
        });
    },

    async delete(contactId) {
        if (!contactId) throw new Error('contactId is required.');
        await fetchGraph(`/me/contacts/${encodeURIComponent(contactId)}`, { method: 'DELETE' });
        return { id: contactId, deleted: true };
    },

    async listLabels() {
        const data = await fetchGraph('/me/outlook/masterCategories');
        return data?.value || [];
    },

    async addLabel(labelName, contactId) {
        if (!labelName || !contactId) throw new Error('labelName and contactId are required.');
        const existing = await contacts.get(contactId);
        const categories = [...new Set([...(existing.categories || []), labelName])];
        return fetchGraph(`/me/contacts/${encodeURIComponent(contactId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ categories })
        });
    },

    async removeLabel(labelName, contactId) {
        if (!labelName || !contactId) throw new Error('labelName and contactId are required.');
        const existing = await contacts.get(contactId);
        const categories = (existing.categories || []).filter((c) => c !== labelName);
        return fetchGraph(`/me/contacts/${encodeURIComponent(contactId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ categories })
        });
    }
};

// --- Microsoft To Do Tasks (/me/todo/lists) CRUD ---
const tasks = {
    async listLists() {
        const data = await fetchGraph('/me/todo/lists');
        return data?.value || [];
    },

    async createList(title) {
        if (!title || !String(title).trim()) throw new Error('Task list title is required.');
        return fetchGraph('/me/todo/lists', {
            method: 'POST',
            body: JSON.stringify({ displayName: String(title).trim() })
        });
    },

    async list(taskListId, { top = 100 } = {}) {
        if (!taskListId) throw new Error('taskListId is required.');
        const data = await fetchGraph(`/me/todo/lists/${encodeURIComponent(taskListId)}/tasks${toQueryString({ $top: top })}`);
        return data?.value || [];
    },

    async find(query, taskListId, options = {}) {
        const words = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (words.length === 0) throw new Error('Search query is required.');
        const items = await tasks.list(taskListId, options);
        return items.filter((item) => {
            const title = (item.title || '').toLowerCase();
            return words.every((w) => title.includes(w));
        });
    },

    async get(taskId, taskListId) {
        if (!taskId || !taskListId) throw new Error('taskId and taskListId are required.');
        return fetchGraph(`/me/todo/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`);
    },

    async create({ title, notes, due } = {}, taskListId) {
        if (!taskListId) throw new Error('taskListId is required.');
        if (!title || !String(title).trim()) throw new Error('Task title is required.');
        const payload = { title: String(title).trim() };
        if (notes !== undefined) payload.body = { content: notes, contentType: 'text' };
        if (due !== undefined) payload.dueDateTime = { dateTime: toISODateTime(due), timeZone: 'UTC' };
        return fetchGraph(`/me/todo/lists/${encodeURIComponent(taskListId)}/tasks`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    },

    async update(taskId, patch = {}, taskListId) {
        if (!taskId || !taskListId) throw new Error('taskId and taskListId are required.');
        const body = {};
        if (patch.title !== undefined) body.title = patch.title;
        if (patch.notes !== undefined) body.body = { content: patch.notes, contentType: 'text' };
        if (patch.status !== undefined) body.status = patch.status;
        if (patch.due !== undefined) {
            body.dueDateTime = patch.due === null ? null : { dateTime: toISODateTime(patch.due), timeZone: 'UTC' };
        }
        return fetchGraph(`/me/todo/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`, {
            method: 'PATCH',
            body: JSON.stringify(body)
        });
    },

    async complete(taskId, taskListId) {
        return tasks.update(taskId, { status: 'completed' }, taskListId);
    },

    async delete(taskId, taskListId) {
        if (!taskId || !taskListId) throw new Error('taskId and taskListId are required.');
        await fetchGraph(`/me/todo/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`, {
            method: 'DELETE'
        });
        return { id: taskId, taskListId, deleted: true };
    }
};

// --- UTCP / Agent Tool Definitions ---
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string' };
const reqStr = { type: 'string', minLength: 1 };
const bool = { type: 'boolean' };
const int = { type: 'integer', minimum: 1 };
const strArr = { type: 'array', items: str };

const TOOL_SPECS = [
    { name: 'ms_calendar_get_events', description: 'Get Microsoft Calendar events for a date range.', readOnly: true, parameters: obj({ start: str, end: str, query: str, calendarId: str, maxResults: int }), run: (a) => calendar.getEvents(a) },
    { name: 'ms_calendar_get_day_events', description: 'Get Microsoft Calendar events for a specific day.', readOnly: true, parameters: obj({ date: str, calendarId: str }), run: (a) => calendar.getDayEvents(a.date || new Date(), { calendarId: a.calendarId || 'primary' }) },
    { name: 'ms_calendar_new_event', description: 'Create a Microsoft Calendar event. Requires user approval.', readOnly: false, requiresApproval: true, actionType: 'create', summarize: (a) => `Create Microsoft event "${a.summary}".`, parameters: obj({ summary: reqStr, description: str, location: str, start: str, end: str, allDay: bool, attendees: strArr, colorId: str, calendarId: str }, ['summary']), run: (a) => calendar.newEvent(a) },
    { name: 'ms_calendar_update_event', description: 'Update a Microsoft Calendar event. Requires user approval.', readOnly: false, requiresApproval: true, actionType: 'update', summarize: (a) => `Update Microsoft event "${a.eventId}".`, parameters: obj({ eventId: reqStr, calendarId: str, patch: obj({ summary: str, description: str, location: str, start: str, end: str, attendees: strArr, colorId: str }) }, ['eventId', 'patch']), run: (a) => calendar.updateEvent(a.eventId, a.patch, a.calendarId || 'primary') },
    { name: 'ms_calendar_delete_event', description: 'Delete a Microsoft Calendar event. Requires user approval.', readOnly: false, requiresApproval: true, actionType: 'delete', summarize: (a) => `Delete Microsoft event "${a.eventId}".`, parameters: obj({ eventId: reqStr, calendarId: str }, ['eventId']), run: (a) => calendar.deleteEvent(a.eventId, a.calendarId || 'primary') },

    { name: 'ms_contacts_find', description: 'Search Microsoft Contacts.', readOnly: true, parameters: obj({ query: reqStr, top: int }, ['query']), run: (a) => contacts.find(a.query, a) },
    { name: 'ms_contacts_list', description: 'List Microsoft Contacts.', readOnly: true, parameters: obj({ top: int, skip: int }), run: (a) => contacts.list(a) },
    { name: 'ms_contacts_create', description: 'Create a Microsoft Contact.', readOnly: false, requiresApproval: false, actionType: 'create', parameters: obj({ givenName: str, familyName: str, displayName: str, email: str, phone: str, organization: str, title: str, notes: str }), run: (a) => contacts.create(a) },
    { name: 'ms_contacts_update', description: 'Update a Microsoft Contact. Requires user approval.', readOnly: false, requiresApproval: true, actionType: 'update', summarize: (a) => `Update Microsoft contact "${a.contactId}".`, parameters: obj({ contactId: reqStr, patch: obj({ givenName: str, familyName: str, displayName: str, email: str, phone: str, organization: str, title: str, notes: str }) }, ['contactId', 'patch']), run: (a) => contacts.update(a.contactId, a.patch) },
    { name: 'ms_contacts_delete', description: 'Delete a Microsoft Contact. Requires user approval.', readOnly: false, requiresApproval: true, actionType: 'delete', summarize: (a) => `Delete Microsoft contact "${a.contactId}".`, parameters: obj({ contactId: reqStr }, ['contactId']), run: (a) => contacts.delete(a.contactId) },
    { name: 'ms_contacts_get_labels', description: 'Get Microsoft Outlook contact categories/labels.', readOnly: true, parameters: obj(), run: () => contacts.listLabels() },
    { name: 'ms_contacts_add_label', description: 'Attach a category/label to a Microsoft Contact.', readOnly: false, requiresApproval: false, actionType: 'update', parameters: obj({ labelName: reqStr, contactId: reqStr }, ['labelName', 'contactId']), run: (a) => contacts.addLabel(a.labelName, a.contactId) },
    { name: 'ms_contacts_remove_label', description: 'Remove a category/label from a Microsoft Contact. Requires user approval.', readOnly: false, requiresApproval: true, actionType: 'update', summarize: (a) => `Remove label "${a.labelName}" from contact "${a.contactId}".`, parameters: obj({ labelName: reqStr, contactId: reqStr }, ['labelName', 'contactId']), run: (a) => contacts.removeLabel(a.labelName, a.contactId) },

    { name: 'ms_tasks_list_lists', description: 'List Microsoft To Do task lists.', readOnly: true, parameters: obj(), run: () => tasks.listLists() },
    { name: 'ms_tasks_create_list', description: 'Create a Microsoft To Do task list. Requires user approval.', readOnly: false, requiresApproval: true, actionType: 'create', summarize: (a) => `Create To Do list "${a.title}".`, parameters: obj({ title: reqStr }, ['title']), run: (a) => tasks.createList(a.title) },
    { name: 'ms_tasks_list', description: 'List tasks in a Microsoft To Do list.', readOnly: true, parameters: obj({ taskListId: reqStr, top: int }, ['taskListId']), run: (a) => tasks.list(a.taskListId, a) },
    { name: 'ms_tasks_find', description: 'Find Microsoft To Do tasks whose titles contain all submitted words.', readOnly: true, parameters: obj({ query: reqStr, taskListId: reqStr }, ['query', 'taskListId']), run: (a) => tasks.find(a.query, a.taskListId) },
    { name: 'ms_tasks_create', description: 'Create a Microsoft To Do task. Requires user approval.', readOnly: false, requiresApproval: true, actionType: 'create', summarize: (a) => `Create To Do task "${a.title}".`, parameters: obj({ title: reqStr, notes: str, due: str, taskListId: reqStr }, ['title', 'taskListId']), run: (a) => tasks.create(a, a.taskListId) },
    { name: 'ms_tasks_update', description: 'Update a Microsoft To Do task. Requires user approval.', readOnly: false, requiresApproval: true, actionType: 'update', summarize: (a) => `Update To Do task "${a.taskId}".`, parameters: obj({ taskId: reqStr, taskListId: reqStr, patch: obj({ title: str, notes: str, due: { type: ['string', 'null'] }, status: { enum: ['notStarted', 'inProgress', 'completed'] } }) }, ['taskId', 'taskListId', 'patch']), run: (a) => tasks.update(a.taskId, a.patch, a.taskListId) },
    { name: 'ms_tasks_complete', description: 'Mark a Microsoft To Do task completed. Requires user approval.', readOnly: false, requiresApproval: true, actionType: 'update', summarize: (a) => `Complete To Do task "${a.taskId}".`, parameters: obj({ taskId: reqStr, taskListId: reqStr }, ['taskId', 'taskListId']), run: (a) => tasks.complete(a.taskId, a.taskListId) },
    { name: 'ms_tasks_delete', description: 'Delete a Microsoft To Do task. Requires user approval.', readOnly: false, requiresApproval: true, actionType: 'delete', summarize: (a) => `Delete To Do task "${a.taskId}".`, parameters: obj({ taskId: reqStr, taskListId: reqStr }, ['taskId', 'taskListId']), run: (a) => tasks.delete(a.taskId, a.taskListId) }
];

function getAgentTools({ requireApproval = true, batchWindowMs = 2000, confirm, promptBatch, onBeforeExecute, onAfterExecute } = {}) {
    const requestApproval = confirm || gTools.createBatchApprover({
        windowMs: batchWindowMs,
        promptBatch: promptBatch || gTools.confirmBatch
    });

    return TOOL_SPECS.map((spec) => {
        const destructive = spec.actionType === 'delete';
        const needsApproval = spec.requiresApproval ?? !spec.readOnly;
        const execute = async (args = {}) => {
            if (needsApproval && requireApproval) {
                const approved = await requestApproval({
                    toolName: spec.name,
                    title: destructive ? 'Confirm Deletion' : 'Approve Microsoft Action',
                    summary: spec.summarize ? spec.summarize(args) : spec.description,
                    actionType: spec.actionType || 'update',
                    details: args
                });
                if (!approved) throw new Error(`User rejected ${spec.name}.`);
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

export const msTools = Object.freeze({
    auth,
    calendar,
    contacts,
    tasks,
    fetchGraph,
    getAgentTools,
    registerWith
});

if (typeof globalThis !== 'undefined') {
    globalThis.msTools = msTools;
}

export default msTools;
