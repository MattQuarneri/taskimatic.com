import { guidanceSystemPrompt, guidanceTapTree } from './task-guidance.js';

// Keep the external companion optional: local tasks and the Guide work without it.
export async function connectTaskAssistant(meme, api, { modelTier = 'smart' } = {}) {
    meme.systemPrompt = guidanceSystemPrompt(modelTier);
    meme.tools = api.tools.list().map(definition => ({
        ...definition,
        inputSchema: definition.parameters,
        effect: definition.annotations.readOnly ? 'none' : 'unsafe',
        handler: args => api.tools.call(definition.name, args)
    }));
    meme.taptree = guidanceTapTree();
    meme.scripts = {
        intro: async () => (await api.prompts.prepare('welcome', { mode: 'tap', modelTier })).prompt
    };
    // Meme boot resolves this registered name after init completes.
    meme.intro = 'intro';
    meme.draggable = true;
    meme.tracking = true;
    meme.location = 'top-center';
    return api.prompts.connect(async request => {
        // Select the composer; microphone capture still starts through Meme’s own controls.
        meme.setPrompterMode(request.mode);
        const result = await meme.ask(request.prompt);
        if (result == null) throw new Error('The assistant did not complete the request. Check its connection or setup and try again.');
        return result;
    });
}

export function installTaskAssistant() {
    if (typeof document === 'undefined') return;
    const source = document.querySelector('meta[name="taskimatic-assistant"]')?.content;
    if (!source) return; // Portable copies omit the external assistant.
    const api = window.taskimatic;
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
