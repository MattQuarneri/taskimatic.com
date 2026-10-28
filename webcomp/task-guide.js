import { PROCESS_STEPS } from '../js/task-guidance.js';

const html = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const entity = kind => kind[0].toUpperCase() + kind.slice(1, -1);
const seenKey = 'taskimatic:guide-seen-v1';

export class TaskGuide extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.mode = 'tap';
        this.step = null;
        this.parentId = '';
        this.busy = false;
        this.onConnection = () => this.updateAgentButton();
    }

    async connectedCallback() {
        if (this._mounted) return;
        this._mounted = true;
        this.render();
        document.addEventListener('taskimatic:guidance-connection', this.onConnection);
        const workspace = this.closest('task-workspace');
        await workspace?.ready;
        if (!this.isConnected) return;
        let seen = false;
        try { seen = localStorage.getItem(seenKey) === 'true'; } catch { /* Storage is optional. */ }
        if (seen || !workspace || ['tasks', 'plans', 'goals', 'wants'].some(kind => workspace[kind].length)) return;
        const otherDialog = document.querySelector('dialog[open]');
        if (otherDialog) otherDialog.addEventListener('close', () => { if (this.isConnected) this.open(); }, { once: true });
        else this.open();
    }

    disconnectedCallback() {
        document.removeEventListener('taskimatic:guidance-connection', this.onConnection);
        this._mounted = false;
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host { font: inherit; color: var(--ink, #18242b); }
                * { box-sizing: border-box; }
                button, input, textarea, select { font: inherit; color: inherit; }
                button { cursor: pointer; border: 1px solid var(--ink, #18242b); border-radius: 8px; padding: 8px 12px; min-height: 38px; background: var(--panel, #fffdf7); }
                button:hover { background: var(--paper, #f3efe4); }
                button:disabled { cursor: default; opacity: .5; }
                button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 3px solid var(--blue, #315f91); outline-offset: 2px; }
                dialog { color: inherit; background: var(--panel, #fffdf7); width: min(660px, calc(100vw - 24px)); max-height: calc(100dvh - 32px); border: 1px solid var(--ink, #18242b); border-radius: 16px; padding: 22px; box-shadow: 5px 6px 0 rgba(24,36,43,.2); }
                dialog::backdrop { background: rgba(24,36,43,.42); }
                header, .actions, .modes { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
                header { justify-content: space-between; }
                h2 { font-size: 1.5em; margin: 0; }
                h3 { font-size: 1.15em; margin: 12px 0 6px; }
                p { line-height: 1.5; }
                .muted, small { color: var(--muted, #697177); }
                .path { font-weight: 750; padding: 12px; background: var(--paper, #f3efe4); border-radius: 8px; line-height: 1.7; }
                .choices { display: grid; gap: 8px; margin: 16px 0; }
                .choices button { text-align: left; padding: 12px; }
                .choices small { display: block; margin-top: 4px; }
                .modes button[aria-pressed="true"], .primary { color: white; background: var(--ink, #18242b); }
                .primary:hover { background: var(--blue, #315f91); }
                label { display: grid; gap: 5px; margin: 12px 0; }
                textarea, input, select { width: 100%; min-width: 0; padding: 9px; border: 1px solid var(--line, #cfc8b8); border-radius: 7px; background: var(--panel, #fffdf7); }
                textarea { min-height: 75px; resize: vertical; }
                textarea[readonly] { min-height: 150px; }
                .actions { margin-top: 16px; }
                .error { color: var(--accent-dark, #b93621); }
                [hidden] { display: none !important; }
                dl { overflow-wrap: anywhere; }
                dt { font-weight: 750; margin-top: 12px; }
                dd { margin: 4px 0; white-space: pre-wrap; line-height: 1.5; }
                @media (max-width: 520px) { dialog { padding: 16px; } .modes button { flex: 1; } }
            </style>
            <button class="launch" type="button">Guide</button>
            <dialog aria-labelledby="guide-title">
                <header><h2 id="guide-title">Make room for what matters</h2><button class="close" type="button" aria-label="Close guide">Close</button></header>
                <div class="body"></div>
                <p class="status" role="status" aria-live="polite"></p>
            </dialog>`;
        this.dialog = this.shadowRoot.querySelector('dialog');
        this.shadowRoot.querySelector('.launch').addEventListener('click', () => this.open());
        this.shadowRoot.querySelector('.close').addEventListener('click', () => this.close());
        this.dialog.addEventListener('close', () => {
            try { localStorage.setItem(seenKey, 'true'); } catch { /* Storage is optional. */ }
            this.shadowRoot.querySelector('.launch').focus();
        });
        this.showWelcome();
    }

    open() {
        if (this.dialog.open) return;
        this.dialog.showModal();
    }

    close() { this.dialog.close(); }
    get api() { return window.taskimatic; }
    get body() { return this.shadowRoot.querySelector('.body'); }
    status(message = '', error = false) {
        const status = this.shadowRoot.querySelector('.status');
        status.textContent = message;
        status.classList.toggle('error', error);
    }

    showWelcome() {
        this.step = null;
        this.status();
        this.body.innerHTML = `
            <p>Welcome to Taskimatic. Start with something you want to change, or pick up wherever you already have clarity.</p>
            <p class="path">Want → Goal → Plan → Task</p>
            <p class="muted">“I want more breathing room” → “My commitments fit within four workdays” → “Audit and simplify my commitments” → “List recurring commitments and weekly hours.”</p>
            <p>How would you like to work with your assistant?</p>
            <div class="modes" role="group" aria-label="Assistant input mode">${['type', 'talk', 'tap'].map(mode => `<button type="button" data-mode="${mode}" aria-pressed="${this.mode === mode}">${mode[0].toUpperCase() + mode.slice(1)}</button>`).join('')}</div>
            <p class="mode-help muted"></p>
            <div class="choices">${PROCESS_STEPS.map(step => `<button type="button" data-step="${step.id}">${html(step.label)}<small>${html(step.question)}</small></button>`).join('')}</div>
            <p class="muted">You can fill in the guide yourself, or pass a process prompt to your connected assistant. Nothing is saved until you choose to save.</p>
            <div class="actions"><button class="later" type="button">Explore on my own</button></div>`;
        const explainMode = () => {
            this.body.querySelector('.mode-help').textContent = { type: 'Type a free-form answer and refine it in conversation.', talk: 'Speak naturally with your assistant’s voice or walkie-talkie mode. Voice is provided by your connected assistant.', tap: 'Choose a process below. Your assistant can guide it with short choices and room for your own answer.' }[this.mode];
        };
        this.body.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
            this.mode = button.dataset.mode;
            this.body.querySelectorAll('[data-mode]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
            explainMode();
        }));
        explainMode();
        this.body.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => this.chooseStep(button.dataset.step)));
        this.body.querySelector('.later').addEventListener('click', () => this.close());
    }

    async chooseStep(id, parentId = '') {
        const step = PROCESS_STEPS.find(item => item.id === id);
        if (!step || this.busy) return;
        this.step = step;
        this.parentId = parentId;
        this.status('Loading…');
        try {
            const parents = step.parentKind ? await this.api.tools.call(`list${entity(step.parentKind)}s`) : [];
            if (this.step !== step) return;
            this.parents = parents;
            this.renderDraft();
            this.status();
        } catch (error) { this.status(error.message, true); }
    }

    renderDraft(draft = {}) {
        const step = this.step;
        this.body.innerHTML = `
            <p class="muted">${html(step.label)} · ${html(this.mode[0].toUpperCase() + this.mode.slice(1))}</p>
            <h3 tabindex="-1">${html(step.question)}</h3><p>${html(step.hint)}</p>
            <form>
                ${step.parentKind ? `<label>From this ${entity(step.parentKind).toLowerCase()}<select name="parentId" required><option value="">Choose a ${entity(step.parentKind).toLowerCase()}</option>${this.parents.map(parent => `<option value="${html(parent.id)}" ${parent.id === this.parentId ? 'selected' : ''}>${html(parent.text)}</option>`).join('')}</select></label>${this.parents.length ? '' : '<p class="muted">Create a parent first to keep this work connected.</p><button class="parent-first" type="button">Start one step earlier</button>'}` : ''}
                ${step.fields.map(field => `<label>${html(field.label)}${field.type === 'date' ? `<input type="date" name="${field.key}" value="${html(draft[field.key])}">` : `<textarea name="${field.key}" ${field.required ? 'required maxlength="1000"' : `maxlength="${field.key === 'notes' || field.key === 'successCriteria' ? 10000 : 50000}"`}>${html(draft[field.key])}</textarea>`}</label>`).join('')}
                <div class="actions"><button class="review primary" type="submit">Review draft</button><button class="back" type="button">Choose another process</button></div>
            </form>
            <details><summary>Use this process with my assistant</summary>
                <p class="connection muted"></p>
                <p class="muted">The prompt includes the selected parent and your draft. Your assistant receives them when you send or paste it.</p>
                <div class="actions"><button class="send" type="button">Send to assistant</button><button class="preview" type="button">Prepare prompt</button></div>
                <label class="prompt-output" hidden>Process prompt<textarea readonly aria-label="Prepared process prompt"></textarea></label>
                <button class="copy" type="button" hidden>Copy prompt</button>
            </details>`;
        const form = this.body.querySelector('form');
        form.addEventListener('submit', event => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(form));
            this.parentId = values.parentId || '';
            delete values.parentId;
            values.text = values.text.trim();
            if (!values.text) { this.status('Give this draft a title before reviewing.', true); return; }
            this.renderReview(values);
        });
        this.body.querySelector('.back').addEventListener('click', () => this.showWelcome());
        this.body.querySelector('.parent-first')?.addEventListener('click', () => this.chooseStep(PROCESS_STEPS[PROCESS_STEPS.indexOf(step) - 1].id));
        this.body.querySelector('.preview').addEventListener('click', () => this.preparePrompt(false));
        this.body.querySelector('.send').addEventListener('click', () => this.preparePrompt(true));
        this.body.querySelector('.copy').addEventListener('click', async () => {
            const output = this.body.querySelector('.prompt-output textarea');
            try { await navigator.clipboard.writeText(output.value); this.status('Prompt copied. Paste it into your assistant.'); }
            catch { output.focus(); output.select(); this.status('Select and copy the prompt above.'); }
        });
        this.updateAgentButton();
        this.body.querySelector('h3').focus();
    }

    updateAgentButton() {
        const send = this.body.querySelector('.send');
        if (!send) return;
        send.disabled = !this.api?.prompts.connected || this.busy;
        this.body.querySelector('.connection').textContent = this.api?.prompts.connected ? 'Your assistant is connected.' : 'No assistant is connected yet. You can copy the prompt or use the guided form.';
    }

    async preparePrompt(send) {
        if (this.busy) return;
        const step = this.step;
        const values = Object.fromEntries(new FormData(this.body.querySelector('form')));
        const options = { mode: this.mode, parentId: values.parentId || null, userInput: JSON.stringify(Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'parentId'))) };
        this.busy = true;
        this.updateAgentButton();
        this.status(send ? 'Sending to your assistant…' : 'Preparing prompt…');
        try {
            if (send) {
                await this.api.prompts.start(step.id, options);
                this.status('Sent to your assistant. Continue the conversation there. Your local draft has not been saved.');
            } else {
                const request = await this.api.prompts.prepare(step.id, options);
                if (this.step !== step) return;
                this.body.querySelector('.prompt-output').hidden = false;
                this.body.querySelector('.prompt-output textarea').value = request.prompt;
                this.body.querySelector('.copy').hidden = false;
                this.status('Prompt ready. Review it, then copy it to your assistant.');
            }
        } catch (error) { this.status(error.message, true); }
        finally { this.busy = false; this.updateAgentButton(); }
    }

    renderReview(draft) {
        const step = this.step;
        const parent = this.parents.find(item => item.id === this.parentId);
        this.status();
        this.body.innerHTML = `<h3 tabindex="-1">Review your ${entity(step.kind).toLowerCase()}</h3><p>Save this draft when it expresses what you mean. You can refine it later.</p>
            ${parent ? `<p>Linked to: <strong>${html(parent.text)}</strong></p>` : ''}
            <dl>${step.fields.filter(field => draft[field.key]).map(field => `<dt>${html(field.label)}</dt><dd>${html(draft[field.key])}</dd>`).join('')}</dl>
            <div class="actions"><button class="save primary" type="button">Save ${entity(step.kind).toLowerCase()}</button><button class="edit" type="button">Edit draft</button></div>`;
        this.body.querySelector('.edit').addEventListener('click', () => this.renderDraft(draft));
        this.body.querySelector('.save').addEventListener('click', () => this.saveDraft(draft));
        this.body.querySelector('h3').focus();
    }

    async saveDraft(draft) {
        if (this.busy) return;
        this.busy = true;
        const button = this.body.querySelector('.save');
        button.disabled = true;
        this.body.querySelector('.edit').disabled = true;
        try {
            const input = { ...draft };
            if (Object.hasOwn(input, 'targetDate') && !input.targetDate) input.targetDate = null;
            const record = this.step.parentKind
                ? await this.api.tools.call('createChild', { kind: this.step.parentKind, id: this.parentId, input })
                : await this.api.tools.call('createWant', { input });
            this.showSaved(record);
        } catch (error) {
            this.status(`Draft kept. ${error.message}`, true);
            button.disabled = false;
            this.body.querySelector('.edit').disabled = false;
        } finally { this.busy = false; }
    }

    showSaved(record) {
        const step = this.step;
        this.status();
        this.body.innerHTML = `<h3 tabindex="-1">${html(entity(step.kind))} saved</h3><p>${html(record.text)}</p><p class="muted">Keep going while it is useful, or come back when you are ready.</p>
            <div class="actions">${step.next ? `<button class="next primary" type="button">${html(PROCESS_STEPS.find(item => item.id === step.next).label)}</button>` : ''}<button class="another" type="button">Add another ${entity(step.kind).toLowerCase()}</button><button class="done" type="button">Done for now</button></div>`;
        this.body.querySelector('.next')?.addEventListener('click', () => this.chooseStep(step.next, record.id));
        this.body.querySelector('.another').addEventListener('click', () => this.chooseStep(step.id, this.parentId));
        this.body.querySelector('.done').addEventListener('click', () => this.close());
        this.body.querySelector('h3').focus();
    }
}

export function installTaskGuide() {
    if (!customElements.get('task-guide')) customElements.define('task-guide', TaskGuide);
}
