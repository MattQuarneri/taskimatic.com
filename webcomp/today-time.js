import { normalizeBreakMinutes, buildTodaySchedule, formatTimelineTime } from '../js/today-time-model.js';

class TodayTime extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._tasks = [];
        this._breakMinutes = 5;
        try { this._breakMinutes = normalizeBreakMinutes(localStorage.getItem('taskimatic-today-break-minutes')); }
        catch (error) { /* Browser storage is optional. */ }
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; margin-bottom: 14px; color: var(--ink, #18242b); }
                * { box-sizing: border-box; }
                header { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; font: 12px/1.5 ui-monospace, monospace; }
                label { display: flex; align-items: center; gap: 5px; }
                input { width: 4em; padding: 4px; border: 1px solid var(--line, #cfc8b8); border-radius: 5px; font: inherit; background: var(--panel, #fffdf7); color: inherit; }
                .scroll { overflow-x: auto; padding-bottom: 6px; }
                .bar { display: flex; height: 68px; border: 1px solid var(--line, #cfc8b8); border-radius: 6px; overflow: hidden; }
                .segment { position: relative; flex-shrink: 0; min-width: 0; border-right: 1px solid #18242b; }
                .name { display: block; padding: 7px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 12px/1.4 system-ui, sans-serif; }
                .done-time { position: absolute; right: 3px; bottom: 5px; background: #ffffffd9; border-radius: 3px; padding: 2px 3px; font: 700 11px/1.2 ui-monospace, monospace; }
                .break { background: #fff; }
                p { margin: 5px 0; color: var(--muted, #697177); font: 12px/1.5 system-ui, sans-serif; }
                .range { display: flex; justify-content: space-between; font: 11px/1.5 ui-monospace, monospace; margin-bottom: 4px; }
            </style>
            <header><strong>Today time</strong><label>Break per hour <input type="number" min="0" max="60" step="1" aria-label="Break minutes after each hour of work"> min</label></header>
            <div class="timeline"></div>
            <p>Priority 1 first · Unestimated tasks: 30 min · Breaks after 60 min of work</p>`;
        this.shadowRoot.querySelector('input').value = this._breakMinutes;
        this.shadowRoot.querySelector('input').addEventListener('change', event => {
            this.breakMinutes = event.target.value;
            try { localStorage.setItem('taskimatic-today-break-minutes', String(this._breakMinutes)); }
            catch (error) { /* Browser storage is optional. */ }
        });
    }

    connectedCallback() {
        this.refresh();
        this._clock = setInterval(() => this.refresh(), 60000);
    }

    disconnectedCallback() { clearInterval(this._clock); }

    set tasks(value) { this._tasks = Array.isArray(value) ? value : []; this.refresh(); }
    get tasks() { return this._schedule?.tasks.map(task => ({ ...task })) || []; }
    set breakMinutes(value) {
        this._breakMinutes = normalizeBreakMinutes(value);
        this.shadowRoot.querySelector('input').value = this._breakMinutes;
        this.refresh();
    }
    get breakMinutes() { return this._breakMinutes; }

    refresh(now = Date.now()) {
        this._schedule = buildTodaySchedule(this._tasks, now, this._breakMinutes);
        const timeline = this.shadowRoot.querySelector('.timeline');
        timeline.replaceChildren();
        if (!this._schedule.tasks.length) {
            const empty = document.createElement('p');
            empty.textContent = 'No unfinished tasks scheduled for today.';
            timeline.append(empty);
        } else {
            const range = document.createElement('div');
            range.className = 'range';
            for (const time of [this._schedule.start, this._schedule.end]) {
                const label = document.createElement('span');
                label.textContent = formatTimelineTime(time);
                range.append(label);
            }
            const scroll = document.createElement('div');
            scroll.className = 'scroll';
            scroll.tabIndex = 0;
            scroll.setAttribute('role', 'region');
            scroll.setAttribute('aria-label', 'Today task schedule, scroll horizontally for more');
            const bar = document.createElement('div');
            bar.className = 'bar';
            const totalMinutes = (this._schedule.end - this._schedule.start) / 60000;
            // A minute always has the same width; scrolling preserves readable completion labels.
            bar.style.width = `${Math.max(100, totalMinutes * 3)}px`;
            bar.style.minWidth = '100%';
            for (const segment of this._schedule.segments) {
                const box = document.createElement('div');
                box.className = `segment ${segment.type}`;
                box.style.width = `${segment.minutes / totalMinutes * 100}%`;
                if (segment.color) box.style.backgroundColor = segment.color;
                const name = segment.type === 'break' ? `Break (${segment.minutes} min)` : segment.text;
                box.title = `${name}: ${formatTimelineTime(segment.start)}–${formatTimelineTime(segment.end)}`;
                box.setAttribute('aria-label', box.title);
                const text = document.createElement('span');
                text.className = 'name';
                text.textContent = name;
                box.append(text);
                if (segment.complete) {
                    const time = document.createElement('span');
                    time.className = 'done-time';
                    time.textContent = formatTimelineTime(segment.end);
                    box.append(time);
                }
                bar.append(box);
            }
            scroll.append(bar);
            timeline.append(range, scroll);
        }
        this.dispatchEvent(new CustomEvent('today-time-change', {
            detail: { tasks: this.tasks }, bubbles: true, composed: true
        }));
    }
}

customElements.define('today-time', TodayTime);
