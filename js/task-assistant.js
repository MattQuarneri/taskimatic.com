import { guidanceSystemPrompt, guidanceTapTree, taskCapabilityReport } from './task-guidance.js';
import { gTools } from './gTools.js';

// CODE (Cognitive Operations Driving Execution) / FILES (Formalized Into Logical
// Encodings): self-knowledge is maintained in task-guidance.js and grounded in
// this connection's tool registry. The host's own powers are not Taskimatic tools.
// getCapabilities is the model-facing read-only route to the same report.
export function describeTaskAssistant(api) {
    return {
        ...taskCapabilityReport(api.tools),
        adapter: {
            source: 'js/task-assistant.js:connectTaskAssistant',
            toolBinding: 'Snapshot of tools.list() at connect; reconnect after registering extensions. Each handler revalidates through tools.call().',
            effects: 'Reads use none; all writes/downloads use unsafe. These are host policy declarations, not an authorization UI or undo system.',
            guidanceConnected: api.prompts.connected,
            connectionMeaning: 'Guide callback installed; does not establish provider health, successful setup, or speech availability.',
            lifecycle: 'Guide modes and requests forward to Meme. Null results and provider errors reject. This adapter does not wire durable runs, abort signals, timeouts, or retry/reconciliation.',
            runtime: 'Optional loader configured by index.html meta; not pinned here. Portable HTML omits it. Runtime internals and remote data handling require separate verification.'
        }
    };
}

// Keep the external companion optional: local tasks and the Guide work without it.
export async function connectTaskAssistant(meme, api, options = {}) {
    const explicitTier = options.modelLevel ?? options.modelTier;
    const resolveTier = (level = meme.modelLevel ?? meme.modelTier) => explicitTier ?? level ?? 'smart';
    const applyTier = level => {
        const tier = resolveTier(level);
        meme.systemPrompt = guidanceSystemPrompt(tier, api.tools);
        meme.taptree = guidanceTapTree(tier);
    };
    applyTier();
    const offModelLevel = meme.on?.('modellevelchange', event => applyTier(event?.detail?.modelLevel));
    meme.tools = api.tools.list().map(definition => ({
        ...definition,
        inputSchema: definition.parameters,
        effect: definition.annotations.readOnly ? 'none' : 'unsafe',
        handler: args => api.tools.call(definition.name, args)
    }));
    meme.scripts = {
        intro: async () => (await api.prompts.prepare('welcome', { mode: 'tap', modelTier: resolveTier() })).prompt
    };
    // Meme boot resolves this registered name after init completes.
    meme.intro = 'intro';
    meme.draggable = true;
    meme.tracking = true;
    meme.location = 'bottom-center';
    const disconnectPrompts = api.prompts.connect(async request => {
        // Select the composer; microphone capture still starts through Meme’s own controls.
        meme.setPrompterMode(request.mode);
        const result = await meme.ask(request.prompt);
        if (result == null) throw new Error('The assistant did not complete the request. Check its connection or setup and try again.');
        return result;
    }, { modelTier: () => resolveTier() });
    return () => {
        offModelLevel?.();
        disconnectPrompts();
    };
}

export function installTaskAssistant() {
    if (typeof document === 'undefined') return;
    const source = document.querySelector('meta[name="taskimatic-assistant"]')?.content;
    if (!source) return; // Portable copies omit the external assistant.
    const api = window.taskimatic;
    if (api?.tools?.register) gTools.registerWith(api.tools);
    window.initMeme = meme => connectTaskAssistant(meme, api);
    const script = document.createElement('script');
    script.dataset.taskimaticAssistant = '';
    const url = new URL(source, document.baseURI);
    url.searchParams.set('init', 'initMeme');
    script.src = url.href;
    script.onerror = () => document.dispatchEvent(new CustomEvent('taskimatic:assistant-error', {
        detail: { message: 'The assistant could not load. Local tasks and the Guide are still available.' }
    }));
    document.body.append(script);
}
