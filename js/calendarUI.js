/**
 * Standalone interactive Calendar Web Component (<calendar-ui>).
 * Connect to any compatible calendar provider (e.g. gTools or msTools) via:
 *   Calendar.connect(gTools, { mode: 'day' | 'week', date, calendarId })
 */

const FALLBACK_EVENT_COLORS = {
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
};

const COLOR_NAMES = {
    '1': 'Lavender', '2': 'Sage', '3': 'Grape', '4': 'Flamingo',
    '5': 'Banana', '6': 'Tangerine', '7': 'Peacock', '8': 'Graphite',
    '9': 'Blueberry', '10': 'Basil', '11': 'Tomato'
};

function ordinalDay(n) {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    switch (n % 10) {
        case 1: return `${n}st`;
        case 2: return `${n}nd`;
        case 3: return `${n}rd`;
        default: return `${n}th`;
    }
}

function formatDayHeader(date) {
    const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date);
    const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(date);
    return `${dayName}, ${monthName} ${ordinalDay(date.getDate())}, ${date.getFullYear()}`;
}

function formatWeekHeader(startDate, endDate) {
    const startMonth = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(startDate);
    const endMonth = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(endDate);
    if (startDate.getFullYear() !== endDate.getFullYear()) {
        return `${startMonth} ${startDate.getFullYear()} – ${endMonth} ${endDate.getFullYear()}`;
    }
    if (startMonth !== endMonth) {
        return `${startMonth} – ${endMonth} ${startDate.getFullYear()}`;
    }
    return `${startMonth} ${startDate.getFullYear()}`;
}

function localDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function isoWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function parseDateProp(val) {
    if (val instanceof Date && !Number.isNaN(val.getTime())) return new Date(val.getFullYear(), val.getMonth(), val.getDate());
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
        const [y, m, d] = val.trim().split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    const parsed = new Date(val || Date.now());
    return Number.isNaN(parsed.getTime()) ? new Date() : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function layoutOverlappingSlots(timedEvents) {
    const items = timedEvents.map((ev) => {
        const s = new Date(ev.start.dateTime);
        const e = new Date(ev.end?.dateTime || s.getTime() + 15 * 60 * 1000);
        const startMin = s.getHours() * 60 + s.getMinutes();
        const rawEndMin = e.getHours() * 60 + e.getMinutes() + (e.getDate() !== s.getDate() ? 24 * 60 : 0);
        const startSlot = Math.floor(startMin / 15);
        const endSlot = Math.max(startSlot + 1, Math.ceil(rawEndMin / 15));
        return { event: ev, startSlot, endSlot, col: 0, totalCols: 1 };
    }).sort((a, b) => a.startSlot - b.startSlot || a.endSlot - b.endSlot);

    const clusters = [];
    let current = [];
    let clusterEnd = -1;
    for (const item of items) {
        if (current.length === 0 || item.startSlot < clusterEnd) {
            current.push(item);
            clusterEnd = Math.max(clusterEnd, item.endSlot);
        } else {
            clusters.push(current);
            current = [item];
            clusterEnd = item.endSlot;
        }
    }
    if (current.length) clusters.push(current);

    for (const cluster of clusters) {
        const colEnds = [];
        for (const item of cluster) {
            let assigned = colEnds.findIndex((end) => end <= item.startSlot);
            if (assigned === -1) {
                assigned = colEnds.length;
                colEnds.push(item.endSlot);
            } else {
                colEnds[assigned] = item.endSlot;
            }
            item.col = assigned;
        }
        const total = colEnds.length;
        for (const item of cluster) item.totalCols = total;
    }
    return items;
}

function defineCalendarUIElement() {
    if (typeof customElements === 'undefined' || customElements.get('calendar-ui')) return;

    class CalendarUIElement extends HTMLElement {
        constructor() {
            super();
            this.attachShadow({ mode: 'open' });
            this._provider = null;
            this._mode = 'day';
            this._date = new Date();
            this._calendarId = 'primary';
            this._events = [];
            this._colors = FALLBACK_EVENT_COLORS;
            this._editingEventId = null;
            this._showCalBox = false;
            this._calBoxMonth = null;
            this._loading = false;
            this._error = '';
        }

        set provider(toolsObj) {
            this._provider = toolsObj?.calendar ? toolsObj.calendar : toolsObj;
            if (this.isConnected) this.refresh();
        }
        get provider() { return this._provider; }

        set mode(val) {
            this._mode = val === 'week' ? 'week' : 'day';
            if (this.isConnected) this.refresh();
        }
        get mode() { return this._mode; }

        set date(val) {
            this._date = parseDateProp(val);
            if (this.isConnected) this.refresh();
        }
        get date() { return this._date; }

        set calendarId(val) {
            this._calendarId = val || 'primary';
            if (this.isConnected) this.refresh();
        }
        get calendarId() { return this._calendarId; }

        connectedCallback() {
            this.refresh();
        }

        _rangeBounds() {
            const base = parseDateProp(this._date);
            if (this._mode === 'day') {
                const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
                const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999);
                return { days: [base], start, end };
            }
            const sunday = new Date(base);
            sunday.setDate(base.getDate() - base.getDay());
            const days = Array.from({ length: 7 }, (_, i) => {
                const d = new Date(sunday);
                d.setDate(sunday.getDate() + i);
                return d;
            });
            const start = new Date(days[0].getFullYear(), days[0].getMonth(), days[0].getDate(), 0, 0, 0, 0);
            const end = new Date(days[6].getFullYear(), days[6].getMonth(), days[6].getDate(), 23, 59, 59, 999);
            return { days, start, end };
        }

        async _loadPalette() {
            if (!this._provider?.getColors) return FALLBACK_EVENT_COLORS;
            try {
                const res = await this._provider.getColors();
                return res?.event || FALLBACK_EVENT_COLORS;
            } catch {
                return FALLBACK_EVENT_COLORS;
            }
        }

        async refresh() {
            if (!this._provider) {
                this._error = 'No calendar provider connected. Use Calendar.connect(gTools).';
                this._render();
                return;
            }
            this._loading = true;
            this._error = '';
            this._render();
            try {
                const { start, end } = this._rangeBounds();
                const [events, palette] = await Promise.all([
                    this._provider.getEvents({ start, end, calendarId: this._calendarId, maxResults: 250 }),
                    this._loadPalette()
                ]);
                this._events = events;
                this._colors = palette;
            } catch (err) {
                this._error = err.message || 'Failed to load calendar events.';
            } finally {
                this._loading = false;
                this._render();
                const scroller = this.shadowRoot?.querySelector('.gc-scroll');
                if (scroller && !scroller.dataset.scrolled) {
                    scroller.scrollTop = 7 * 4 * 18;
                    scroller.dataset.scrolled = '1';
                }
            }
        }

        _shift(delta) {
            const d = new Date(this._date);
            d.setDate(d.getDate() + (this._mode === 'week' ? delta * 7 : delta));
            this.date = d;
        }

        async _saveInlineEdit(event, inputEl, colorEl, saveBtn, cancelBtn) {
            const newSummary = inputEl.value.trim();
            if (!newSummary) return;
            const newColorId = colorEl.value || undefined;
            inputEl.disabled = true;
            colorEl.disabled = true;
            saveBtn.disabled = true;
            cancelBtn.disabled = true;
            this._error = '';

            try {
                const patch = { summary: newSummary };
                if (newColorId) patch.colorId = newColorId;
                const updated = await this._provider.updateEvent(event.id, patch, this._calendarId);
                const idx = this._events.findIndex((e) => e.id === event.id);
                if (idx !== -1) this._events[idx] = { ...this._events[idx], ...updated };
                this._editingEventId = null;
                this._render();
            } catch (err) {
                this._error = `Save failed: ${err.message}`;
                this._editingEventId = null;
                this._render();
            }
        }

        _renderEventBox(item) {
            const { event, startSlot, endSlot, col, totalCols } = item;
            const slotPx = 18;
            const top = startSlot * slotPx;
            const height = Math.max(slotPx - 2, (endSlot - startSlot) * slotPx - 2);
            const widthPct = 100 / totalCols;
            const leftPct = col * widthPct;

            const colorEntry = this._colors[event.colorId] || { background: '#2563eb', foreground: '#ffffff' };
            const box = document.createElement('div');
            box.className = 'gc-event';
            box.style.top = `${top}px`;
            box.style.height = `${height}px`;
            box.style.left = `calc(${leftPct}% + 2px)`;
            box.style.width = `calc(${widthPct}% - 4px)`;
            box.style.backgroundColor = colorEntry.background;
            box.style.color = colorEntry.foreground;

            if (this._editingEventId === event.id) {
                box.classList.add('gc-event-editing');
                box.style.zIndex = '20';
                box.style.height = 'auto';
                box.style.minHeight = `${Math.max(height, 64)}px`;

                const form = document.createElement('form');
                form.className = 'gc-edit-form';
                const input = document.createElement('input');
                input.type = 'text';
                input.value = event.summary || '';
                input.setAttribute('aria-label', 'Event title');

                const colorSelect = document.createElement('select');
                colorSelect.setAttribute('aria-label', 'Event color');
                const defaultOpt = document.createElement('option');
                defaultOpt.value = '';
                defaultOpt.textContent = 'Default';
                colorSelect.appendChild(defaultOpt);
                for (const [cid, cname] of Object.entries(COLOR_NAMES)) {
                    const opt = document.createElement('option');
                    opt.value = cid;
                    opt.textContent = cname;
                    if (event.colorId === cid) opt.selected = true;
                    colorSelect.appendChild(opt);
                }

                const actions = document.createElement('div');
                actions.className = 'gc-edit-actions';
                const saveBtn = document.createElement('button');
                saveBtn.type = 'submit';
                saveBtn.textContent = 'Save';
                const moreBtn = document.createElement('button');
                moreBtn.type = 'button';
                moreBtn.textContent = 'More';
                const cancelBtn = document.createElement('button');
                cancelBtn.type = 'button';
                cancelBtn.textContent = 'Cancel';

                moreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._openMoreDialog(event);
                });
                cancelBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._editingEventId = null;
                    this._render();
                });
                form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._saveInlineEdit(event, input, colorSelect, saveBtn, cancelBtn);
                });
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        this._editingEventId = null;
                        this._render();
                    }
                });

                actions.append(saveBtn, moreBtn, cancelBtn);
                form.append(input, colorSelect, actions);
                box.appendChild(form);
                queueMicrotask(() => input.focus());
            } else {
                const startStr = new Date(event.start.dateTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                box.title = `${event.summary || 'Untitled'} (${startStr}) — Click to edit, drag to move`;
                const titleEl = document.createElement('span');
                titleEl.className = 'gc-event-title';
                titleEl.textContent = event.summary || '(Untitled)';
                const timeEl = document.createElement('span');
                timeEl.className = 'gc-event-time';
                timeEl.textContent = startStr;
                const resizeHandle = document.createElement('div');
                resizeHandle.className = 'gc-resize-handle';
                resizeHandle.title = 'Drag to resize (15 min increments)';
                box.append(titleEl, timeEl, resizeHandle);
                this._attachDragHandlers(box, resizeHandle, item);
            }
            return box;
        }

        _attachDragHandlers(box, resizeHandle, item) {
            const { event, startSlot, endSlot } = item;
            const slotPx = 18;
            const durationSlots = Math.max(1, endSlot - startSlot);

            const commitTimeChange = async (targetDateKey, newStartSlot, newEndSlot) => {
                const origStart = new Date(event.start.dateTime);
                const origEnd = new Date(event.end?.dateTime || origStart.getTime() + durationSlots * 15 * 60 * 1000);
                const [y, m, d] = targetDateKey.split('-').map(Number);
                const newStart = new Date(y, m - 1, d, 0, newStartSlot * 15, 0, 0);
                const newEnd = new Date(y, m - 1, d, 0, newEndSlot * 15, 0, 0);

                if (newStart.getTime() === origStart.getTime() && newEnd.getTime() === origEnd.getTime()) {
                    this._render();
                    return;
                }

                box.classList.add('gc-event-saving');
                this._error = '';
                try {
                    const updated = await this._provider.updateEvent(event.id, {
                        start: newStart.toISOString(),
                        end: newEnd.toISOString()
                    }, this._calendarId);
                    const idx = this._events.findIndex((e) => e.id === event.id);
                    if (idx !== -1) this._events[idx] = { ...this._events[idx], ...updated };
                } catch (err) {
                    this._error = `Update failed: ${err.message}`;
                } finally {
                    this._render();
                }
            };

            resizeHandle.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const startY = e.clientY;
                let currentEndSlot = endSlot;
                const colEl = box.closest('.gc-day-col');
                const dayKey = colEl?.dataset.day || localDateKey(new Date(event.start.dateTime));

                const onMove = (ev) => {
                    const deltaSlots = Math.round((ev.clientY - startY) / slotPx);
                    currentEndSlot = Math.min(96, Math.max(startSlot + 1, endSlot + deltaSlots));
                    box.style.height = `${Math.max(slotPx - 2, (currentEndSlot - startSlot) * slotPx - 2)}px`;
                };
                const onUp = () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    commitTimeChange(dayKey, startSlot, currentEndSlot);
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
            });

            box.addEventListener('pointerdown', (e) => {
                if (e.target === resizeHandle || e.button !== 0) return;
                e.stopPropagation();
                const startX = e.clientX;
                const startY = e.clientY;
                let moved = false;
                let currentStartSlot = startSlot;
                const cols = [...this.shadowRoot.querySelectorAll('.gc-day-col')];
                let targetCol = box.closest('.gc-day-col');
                const origDayKey = targetCol?.dataset.day || localDateKey(new Date(event.start.dateTime));

                const onMove = (ev) => {
                    if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
                    moved = true;
                    box.classList.add('gc-event-dragging');

                    const deltaSlots = Math.round((ev.clientY - startY) / slotPx);
                    currentStartSlot = Math.max(0, Math.min(96 - durationSlots, startSlot + deltaSlots));
                    box.style.top = `${currentStartSlot * slotPx}px`;

                    if (this._mode === 'week') {
                        const hoveredCol = cols.find((c) => {
                            const r = c.getBoundingClientRect();
                            return ev.clientX >= r.left && ev.clientX <= r.right;
                        });
                        if (hoveredCol && hoveredCol !== targetCol) {
                            targetCol = hoveredCol;
                            targetCol.appendChild(box);
                        }
                    }
                };

                const onUp = () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    box.classList.remove('gc-event-dragging');
                    if (!moved) {
                        if (this._mode === 'week') this._openMoreDialog(event);
                        else {
                            this._editingEventId = event.id;
                            this._render();
                        }
                        return;
                    }
                    const finalDayKey = targetCol?.dataset.day || origDayKey;
                    commitTimeChange(finalDayKey, currentStartSlot, currentStartSlot + durationSlots);
                };

                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
            });
        }

        _openMoreDialog(event) {
            const root = this.shadowRoot;
            let dialog = root.querySelector('dialog.gc-more-dialog');
            if (!dialog) {
                dialog = document.createElement('dialog');
                dialog.className = 'gc-more-dialog';
                dialog.setAttribute('aria-labelledby', 'gc-more-title');
                root.appendChild(dialog);
            }

            const toLocalInput = (iso) => {
                if (!iso) return '';
                const d = new Date(iso);
                if (Number.isNaN(d.getTime())) return '';
                const pad = (n) => String(n).padStart(2, '0');
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
            };

            let editUrl = event.htmlLink || '';
            try {
                const eid = editUrl ? new URL(editUrl).searchParams.get('eid') : '';
                if (eid) editUrl = `https://calendar.google.com/calendar/r/eventedit/${encodeURIComponent(eid)}`;
            } catch {
                // Keep htmlLink as-is.
            }

            const colorOptions = ['<option value="">Default</option>']
                .concat(Object.entries(COLOR_NAMES).map(([cid, cname]) => `<option value="${cid}"${event.colorId === cid ? ' selected' : ''}>${cname}</option>`))
                .join('');
            const attendeesVal = (event.attendees || []).map((a) => a.email).filter(Boolean).join(', ');

            dialog.innerHTML = `
                <div class="gc-dlg-head">
                    <h4 id="gc-more-title">Edit Event Details</h4>
                    ${editUrl ? `<a class="gc-dlg-ext" href="${editUrl}" target="_blank" rel="noopener">Open Externally &#8599;</a>` : ''}
                </div>
                <form class="gc-dlg-form">
                    <label>Title<input name="summary" type="text" required></label>
                    <div class="gc-dlg-row">
                        <label>Start<input name="start" type="datetime-local"></label>
                        <label>End<input name="end" type="datetime-local"></label>
                    </div>
                    <div class="gc-dlg-row">
                        <label>Location<input name="location" type="text"></label>
                        <label>Color<select name="colorId">${colorOptions}</select></label>
                    </div>
                    <label>Attendees (comma-separated emails)<input name="attendees" type="text"></label>
                    <label>Description<textarea name="description" rows="3"></textarea></label>
                    <div class="gc-dlg-err" hidden></div>
                    <div class="gc-dlg-actions">
                        <button type="button" class="gc-dlg-delete" data-action="delete">Delete</button>
                        <span class="gc-dlg-spacer"></span>
                        <button type="button" data-action="cancel" autofocus>Cancel</button>
                        <button type="submit" class="gc-dlg-save">Save</button>
                    </div>
                </form>
            `;

            const form = dialog.querySelector('form');
            form.summary.value = event.summary || '';
            form.start.value = toLocalInput(event.start?.dateTime);
            form.end.value = toLocalInput(event.end?.dateTime);
            form.location.value = event.location || '';
            form.attendees.value = attendeesVal;
            form.description.value = event.description || '';

            const errEl = dialog.querySelector('.gc-dlg-err');
            const setBusy = (busy) => {
                form.querySelectorAll('input, select, textarea, button').forEach((el) => { el.disabled = busy; });
            };

            dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close('cancel'));
            dialog.addEventListener('close', () => { dialog.returnValue = ''; }, { once: true });

            dialog.querySelector('[data-action="delete"]').addEventListener('click', async () => {
                setBusy(true);
                errEl.hidden = true;
                try {
                    await this._provider.deleteEvent(event.id, this._calendarId);
                    this._events = this._events.filter((e) => e.id !== event.id);
                    this._editingEventId = null;
                    dialog.close('deleted');
                    this._render();
                } catch (err) {
                    errEl.textContent = err.message;
                    errEl.hidden = false;
                    setBusy(false);
                }
            });

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                setBusy(true);
                errEl.hidden = true;
                try {
                    const patch = {
                        summary: form.summary.value.trim(),
                        location: form.location.value,
                        description: form.description.value
                    };
                    if (form.start.value) patch.start = new Date(form.start.value).toISOString();
                    if (form.end.value) patch.end = new Date(form.end.value).toISOString();
                    if (form.colorId.value) patch.colorId = form.colorId.value;
                    if (form.attendees.value.trim()) {
                        patch.attendees = form.attendees.value.split(',').map((s) => s.trim()).filter(Boolean);
                    }
                    const updated = await this._provider.updateEvent(event.id, patch, this._calendarId);
                    const idx = this._events.findIndex((ev) => ev.id === event.id);
                    if (idx !== -1) this._events[idx] = { ...this._events[idx], ...updated };
                    this._editingEventId = null;
                    dialog.close('saved');
                    this._render();
                } catch (err) {
                    errEl.textContent = err.message;
                    errEl.hidden = false;
                    setBusy(false);
                }
            });

            dialog.showModal();
        }

        _renderCalBox() {
            const base = this._calBoxMonth || new Date(this._date.getFullYear(), this._date.getMonth(), 1);
            const activeMonth = base.getMonth();
            const activeYear = base.getFullYear();
            const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(base);

            const firstOfMonth = new Date(activeYear, activeMonth, 1);
            const gridStart = new Date(firstOfMonth);
            gridStart.setDate(1 - firstOfMonth.getDay());

            const todayKey = localDateKey(new Date());
            const selectedKey = localDateKey(this._date);

            const rows = [];
            for (let w = 0; w < 6; w++) {
                const weekStart = new Date(gridStart);
                weekStart.setDate(gridStart.getDate() + w * 7);
                const thursday = new Date(weekStart);
                thursday.setDate(weekStart.getDate() + 4);
                const weekNum = isoWeekNumber(thursday);
                const weekKey = localDateKey(weekStart);

                let cells = `<button type="button" class="gc-cb-week" data-cb-week="${weekKey}" title="Open week #${weekNum}">#${weekNum}</button>`;
                for (let d = 0; d < 7; d++) {
                    const day = new Date(weekStart);
                    day.setDate(weekStart.getDate() + d);
                    const key = localDateKey(day);
                    const inMonth = day.getMonth() === activeMonth;
                    cells += `<button type="button" class="gc-cb-day${inMonth ? ' gc-cb-in' : ' gc-cb-out'}${key === todayKey ? ' gc-cb-today' : ''}${key === selectedKey ? ' gc-cb-selected' : ''}" data-cb-day="${key}">${day.getDate()}</button>`;
                }
                rows.push(cells);
            }

            return `
                <div class="gc-calbox" role="region" aria-label="Calendar month picker">
                    <div class="gc-cb-head">
                        <span class="gc-cb-title">${monthLabel}</span>
                        <div class="gc-cb-nav">
                            <button type="button" data-cb-month="-1" aria-label="Previous month">&lsaquo;</button>
                            <button type="button" data-cb-month="1" aria-label="Next month">&rsaquo;</button>
                        </div>
                    </div>
                    <div class="gc-cb-grid">
                        <span class="gc-cb-corner"></span>
                        <span class="gc-cb-dow">S</span><span class="gc-cb-dow">M</span><span class="gc-cb-dow">T</span><span class="gc-cb-dow">W</span><span class="gc-cb-dow">T</span><span class="gc-cb-dow">F</span><span class="gc-cb-dow">S</span>
                        ${rows.join('')}
                    </div>
                </div>
            `;
        }

        _render() {
            const { days } = this._rangeBounds();
            const headerLabel = this._mode === 'day'
                ? formatDayHeader(days[0])
                : formatWeekHeader(days[0], days[6]);

            const root = this.shadowRoot;
            root.innerHTML = `
                <style>
                    :host { display: block; font-family: system-ui, -apple-system, sans-serif; color: #111827; background: #fff; border: 1px solid #e5e7eb; border-radius: 0.75rem; overflow: hidden; }
                    .gc-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.75rem 1rem; border-bottom: 1px solid #e5e7eb; background: #f9fafb; flex-wrap: wrap; }
                    .gc-heading-btn { margin: 0; font: inherit; font-size: 1rem; font-weight: 600; background: none; border: none; padding: 0.15rem 0.4rem; border-radius: 0.375rem; cursor: pointer; color: #111827; text-align: left; }
                    .gc-heading-btn:hover { background: #e5e7eb; }
                    .gc-calbox { padding: 0.75rem 1rem; border-bottom: 1px solid #e5e7eb; background: #f8fafc; }
                    .gc-cb-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
                    .gc-cb-title { font-size: 0.875rem; font-weight: 600; color: #111827; }
                    .gc-cb-nav { display: flex; gap: 0.25rem; }
                    .gc-cb-nav button { font: inherit; font-size: 0.85rem; width: 1.75rem; height: 1.75rem; border: 1px solid #d1d5db; background: #fff; border-radius: 0.375rem; cursor: pointer; color: #374151; }
                    .gc-cb-nav button:hover { background: #f3f4f6; }
                    .gc-cb-grid { display: grid; grid-template-columns: 2.5rem repeat(7, minmax(0, 1fr)); gap: 0.2rem; align-items: center; text-align: center; }
                    .gc-cb-dow { font-size: 0.7rem; font-weight: 600; color: #6b7280; padding: 0.2rem 0; }
                    .gc-cb-week { font: inherit; font-size: 0.7rem; font-weight: 600; color: #6b7280; background: #e5e7eb; border: none; border-radius: 0.25rem; padding: 0.25rem 0.2rem; cursor: pointer; }
                    .gc-cb-week:hover { background: #2563eb; color: #fff; }
                    .gc-cb-day { font: inherit; font-size: 0.78rem; background: none; border: 1px solid transparent; border-radius: 0.3rem; padding: 0.25rem 0; cursor: pointer; }
                    .gc-cb-in { font-weight: 700; color: #111827; }
                    .gc-cb-out { font-weight: 400; color: #9ca3af; }
                    .gc-cb-day:hover { background: #e5e7eb; }
                    .gc-cb-today { border-color: #2563eb; color: #2563eb; }
                    .gc-cb-selected { background: #2563eb !important; color: #fff !important; }
                    .gc-controls { display: flex; gap: 0.35rem; align-items: center; }
                    .gc-controls button { font: inherit; font-size: 0.75rem; font-weight: 500; padding: 0.35rem 0.65rem; border: 1px solid #d1d5db; background: #fff; border-radius: 0.375rem; cursor: pointer; color: #374151; }
                    .gc-controls button:hover { background: #f3f4f6; }
                    .gc-controls button[data-active="true"] { background: #2563eb; color: #fff; border-color: #2563eb; }
                    .gc-error { padding: 0.5rem 1rem; background: #fef2f2; color: #b91c1c; font-size: 0.8rem; border-bottom: 1px solid #fecaca; }
                    .gc-col-headers { display: grid; grid-template-columns: 3.75rem repeat(${days.length}, minmax(0, 1fr)); border-bottom: 1px solid #e5e7eb; background: #fff; }
                    .gc-col-head { font: inherit; padding: 0.4rem 0.5rem; text-align: center; font-size: 0.75rem; font-weight: 600; color: #374151; border: none; border-left: 1px solid #f3f4f6; background: transparent; cursor: pointer; }
                    .gc-col-head:hover { background: #f3f4f6; }
                    .gc-col-head[data-today="true"] { color: #2563eb; background: #eff6ff; }
                    .gc-scroll { max-height: 460px; overflow-y: auto; position: relative; }
                    .gc-grid { display: grid; grid-template-columns: 3.75rem repeat(${days.length}, minmax(0, 1fr)); position: relative; height: ${96 * 18}px; }
                    .gc-times { position: relative; border-right: 1px solid #e5e7eb; background: #fafafa; }
                    .gc-hour-label { position: absolute; right: 0.4rem; font-size: 0.68rem; color: #6b7280; transform: translateY(-50%); }
                    .gc-day-col { position: relative; border-left: 1px solid #f3f4f6; background-image: linear-gradient(to bottom, #e5e7eb 1px, transparent 1px), linear-gradient(to bottom, #f3f4f6 1px, transparent 1px); background-size: 100% 72px, 100% 18px; }
                    .gc-event { position: absolute; border-radius: 0.3rem; padding: 0.15rem 0.45rem 0.15rem 0.35rem; font-size: 0.72rem; line-height: 1.2; overflow: hidden; cursor: grab; box-sizing: border-box; box-shadow: 0 1px 2px rgb(0 0 0 / 0.12); display: flex; gap: 0.3rem; align-items: baseline; user-select: none; touch-action: none; }
                    .gc-event-dragging { opacity: 0.85; cursor: grabbing; z-index: 30; box-shadow: 0 10px 18px rgb(0 0 0 / 0.22); }
                    .gc-event-saving { opacity: 0.55; pointer-events: none; filter: grayscale(0.3); }
                    .gc-resize-handle { position: absolute; right: 2px; bottom: 2px; width: 10px; height: 10px; cursor: ns-resize; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; opacity: 0.65; border-radius: 1px; }
                    .gc-resize-handle:hover { opacity: 1; }
                    .gc-event-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                    .gc-event-time { font-size: 0.65rem; opacity: 0.85; white-space: nowrap; }
                    .gc-event-editing { padding: 0.35rem; box-shadow: 0 8px 16px rgb(0 0 0 / 0.2); }
                    .gc-edit-form { display: flex; flex-direction: column; gap: 0.25rem; width: 100%; }
                    .gc-edit-form input, .gc-edit-form select { font: inherit; font-size: 0.75rem; padding: 0.2rem 0.3rem; border-radius: 0.25rem; border: 1px solid #d1d5db; color: #111827; background: #fff; }
                    .gc-edit-actions { display: flex; gap: 0.25rem; }
                    .gc-edit-actions button { font: inherit; font-size: 0.7rem; padding: 0.2rem 0.45rem; border-radius: 0.25rem; border: 1px solid #d1d5db; cursor: pointer; background: #fff; color: #111827; }
                    .gc-edit-actions button[type="submit"] { background: #111827; color: #fff; border-color: #111827; }
                    dialog.gc-more-dialog { border: 1px solid #e5e7eb; border-radius: 0.75rem; padding: 0; width: min(32rem, calc(100vw - 2rem)); box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.18); font-family: inherit; color: #111827; }
                    dialog.gc-more-dialog:modal { overscroll-behavior: contain; }
                    dialog.gc-more-dialog::backdrop { background: rgb(15 23 42 / 0.55); overflow: hidden; overscroll-behavior: contain; }
                    .gc-dlg-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.85rem 1rem; border-bottom: 1px solid #f3f4f6; }
                    .gc-dlg-head h4 { margin: 0; font-size: 0.95rem; font-weight: 600; }
                    .gc-dlg-ext { font-size: 0.75rem; color: #2563eb; text-decoration: none; font-weight: 500; }
                    .gc-dlg-ext:hover { text-decoration: underline; }
                    .gc-dlg-form { display: flex; flex-direction: column; gap: 0.65rem; padding: 1rem; font-size: 0.8rem; }
                    .gc-dlg-form label { display: flex; flex-direction: column; gap: 0.2rem; font-weight: 500; color: #374151; }
                    .gc-dlg-form input, .gc-dlg-form select, .gc-dlg-form textarea { font: inherit; padding: 0.4rem 0.5rem; border: 1px solid #d1d5db; border-radius: 0.375rem; color: #111827; background: #fff; }
                    .gc-dlg-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.65rem; }
                    .gc-dlg-err { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 0.375rem; padding: 0.4rem 0.6rem; font-size: 0.78rem; }
                    .gc-dlg-actions { display: flex; align-items: center; gap: 0.5rem; padding-top: 0.35rem; }
                    .gc-dlg-spacer { flex: 1; }
                    .gc-dlg-actions button { font: inherit; font-size: 0.8rem; font-weight: 500; padding: 0.45rem 0.85rem; border-radius: 0.375rem; border: 1px solid #d1d5db; background: #fff; cursor: pointer; }
                    .gc-dlg-save { background: #2563eb !important; color: #fff !important; border-color: #2563eb !important; }
                    .gc-dlg-delete { background: #fef2f2 !important; color: #b91c1c !important; border-color: #fecaca !important; }
                </style>
                <div class="gc-toolbar">
                    <button type="button" class="gc-heading-btn" data-toggle-calbox="true" title="Toggle month picker">${headerLabel}${this._loading ? ' (Loading...)' : ''} &#9662;</button>
                    <div class="gc-controls">
                        <button type="button" data-nav="-1">&lsaquo; Prev</button>
                        <button type="button" data-nav="today">Today</button>
                        <button type="button" data-nav="1">Next &rsaquo;</button>
                        <button type="button" data-mode="day" data-active="${this._mode === 'day'}">Day</button>
                        <button type="button" data-mode="week" data-active="${this._mode === 'week'}">Week</button>
                    </div>
                </div>
                ${this._showCalBox ? this._renderCalBox() : ''}
                ${this._error ? `<div class="gc-error" role="alert"></div>` : ''}
                ${this._mode === 'week' ? `<div class="gc-col-headers"><div></div>${days.map((d) => {
                    const key = localDateKey(d);
                    const isToday = key === localDateKey(new Date());
                    const label = `${new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(d)} ${d.getDate()}`;
                    return `<button type="button" class="gc-col-head" data-today="${isToday}" data-col-day="${key}" title="Open Day view">${label}</button>`;
                }).join('')}</div>` : ''}
                <div class="gc-scroll">
                    <div class="gc-grid">
                        <div class="gc-times"></div>
                    </div>
                </div>
            `;

            if (this._error) {
                root.querySelector('.gc-error').textContent = this._error;
            }

            const timesCol = root.querySelector('.gc-times');
            for (let h = 0; h < 24; h++) {
                const lbl = document.createElement('span');
                lbl.className = 'gc-hour-label';
                lbl.style.top = `${h * 72 + (h === 0 ? 8 : 0)}px`;
                lbl.textContent = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
                timesCol.appendChild(lbl);
            }

            const grid = root.querySelector('.gc-grid');
            for (const day of days) {
                const key = localDateKey(day);
                const col = document.createElement('div');
                col.className = 'gc-day-col';
                col.dataset.day = key;
                const dayTimed = this._events.filter((ev) => ev.start?.dateTime && localDateKey(new Date(ev.start.dateTime)) === key);
                for (const item of layoutOverlappingSlots(dayTimed)) {
                    col.appendChild(this._renderEventBox(item));
                }
                grid.appendChild(col);
            }

            root.querySelector('[data-toggle-calbox]')?.addEventListener('click', () => {
                this._showCalBox = !this._showCalBox;
                if (this._showCalBox) {
                    this._calBoxMonth = new Date(this._date.getFullYear(), this._date.getMonth(), 1);
                }
                this._render();
            });
            root.querySelectorAll('[data-cb-month]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const cur = this._calBoxMonth || new Date(this._date.getFullYear(), this._date.getMonth(), 1);
                    this._calBoxMonth = new Date(cur.getFullYear(), cur.getMonth() + Number(btn.dataset.cbMonth), 1);
                    this._render();
                });
            });
            root.querySelectorAll('[data-cb-day]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this._showCalBox = false;
                    this._mode = 'day';
                    this.date = btn.dataset.cbDay;
                });
            });
            root.querySelectorAll('[data-cb-week]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this._showCalBox = false;
                    this._mode = 'week';
                    this.date = btn.dataset.cbWeek;
                });
            });
            root.querySelectorAll('[data-col-day]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this._mode = 'day';
                    this.date = btn.dataset.colDay;
                });
            });
            root.querySelectorAll('[data-nav]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const v = btn.dataset.nav;
                    if (v === 'today') this.date = new Date();
                    else this._shift(Number(v));
                });
            });
            root.querySelectorAll('[data-mode]').forEach((btn) => {
                btn.addEventListener('click', () => { this.mode = btn.dataset.mode; });
            });
        }
    }

    customElements.define('calendar-ui', CalendarUIElement);
}

export const Calendar = Object.freeze({
    connect(tools, { mode = 'day', date = new Date(), calendarId = 'primary' } = {}) {
        if (typeof document === 'undefined' || typeof customElements === 'undefined') {
            throw new Error('Calendar.connect() requires a browser DOM environment.');
        }
        defineCalendarUIElement();
        const el = document.createElement('calendar-ui');
        el.provider = tools;
        el.mode = mode === 'week' ? 'week' : 'day';
        el.calendarId = calendarId;
        el.date = date;
        return el;
    }
});

if (typeof globalThis !== 'undefined') {
    globalThis.Calendar = Calendar;
}

export default Calendar;
