import fs from 'node:fs';
import vm from 'node:vm';

export const english = JSON.parse(fs.readFileSync(new URL('../data/i18n/en.json', import.meta.url), 'utf8'));
export function createI18nContext(options = {}) {
    const embedded = {data: {en: english}, languages: {en: {Lang: 'English'}}, defaultLang: 'en', ...options.embedded};
    const store = new Map();
    const mockStorage = {
        getItem: k => store.get(k) ?? null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: k => store.delete(k),
        clear: () => store.clear()
    };
    const storage = options.localStorage || mockStorage;
    const nav = options.navigator || {language: 'en', languages: ['en']};
    const win = {
        location: {search: options.search || '', protocol: 'https:'},
        localStorage: storage,
        navigator: nav
    };
    const context = vm.createContext({
        window: win,
        localStorage: storage,
        console,
        URL,
        URLSearchParams,
        navigator: nav,
        document: {readyState: 'loading', baseURI: 'https://taskimatic.test/', cookie: options.cookie || '',
            getElementById: id => id === 'taskimatic-i18n' ? {textContent: JSON.stringify(embedded)} : null,
            addEventListener() {}}
    });
    vm.runInContext(fs.readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8'), context);
    return context;
}
export const {t, escapeHTML, uiLabel, window: {i18n}} = createI18nContext();
