import { openFloatingFileView, guessMimeType } from '../webcomp/floating-file-view.js';
import { fileRepo } from './file-repo.js';

export function fileAssociationName(association) {
    if (association.file?.name) return association.file.name;
    try {
        const url = new URL(association.value);
        return decodeURIComponent(url.pathname.split('/').pop()) || url.hostname || association.value;
    } catch { return String(association.value).split(/[\\/]/).pop() || association.value; }
}

export function validFileLink(value) {
    try { return Boolean(new URL(value).protocol); } catch { return false; }
}

export async function openFileAssociation(association) {
    const file = association.file;
    const mime = file?.mime && file.mime !== 'application/octet-stream' ? file.mime : guessMimeType(fileAssociationName(association));
    let url = file?.data;
    if (file?.id) url = URL.createObjectURL(new Blob([await fileRepo.get(file.id)], {type: mime}));
    const value = association.value;
    const isURL = validFileLink(value);
    const viewer = openFloatingFileView({
        key: file?.id ? `filerepo:${file.id}` : undefined,
        path: file || isURL ? '' : value,
        url: url || (isURL ? value : undefined),
        ownedUrl: Boolean(file?.id),
        name: fileAssociationName(association), mime, size: file?.size
    });
    if (file?.id && viewer?.file?.url !== url) URL.revokeObjectURL(url);
    return viewer;
}

export function createFilePill(association) {
    const pill = document.createElement('a');
    pill.className = 'file-pill';
    pill.textContent = fileAssociationName(association);
    pill.title = association.value;
    pill.setAttribute('aria-label', `Open file: ${fileAssociationName(association)}`);
    pill.href = association.value;
    pill.target = '_blank';
    pill.rel = 'noopener noreferrer';
    pill.addEventListener('click', event => {
        event.stopPropagation();
        if (/^(javascript|vbscript):/i.test(association.value)) {
            event.preventDefault();
            window.alert('This URL is saved. Script URLs cannot be opened as files.');
            return;
        }
        // Non-fetchable protocols (file:, mailto:, custom handlers, etc.) use
        // the browser's normal link handling, in a separate browsing context.
        if (!association.file && validFileLink(association.value) && !/^(https?|blob):/i.test(association.value)) return;
        event.preventDefault();
        openFileAssociation(association).catch(error => window.alert(error.message));
    });
    return pill;
}

export async function associationFromFile(file) {
    const metadata = await fileRepo.put(file);
    return {type: 'file', value: `filerepo:${metadata.id}/${encodeURIComponent(metadata.name)}`, file: metadata};
}

// Shared by tasks, plans, goals and wants. Keep custom property entry available
// while exposing a real dropdown rather than relying on datalist suggestions.
export function installFileAssociationEditor(form, typeInput, valueInput, properties, onAdd) {
    const property = form.querySelector('.association-property-select');
    const sources = form.querySelector('.file-source');
    const localInput = form.querySelector('.association-local-file');
    let mode = 'link';
    property.replaceChildren();
    for (const value of ['', ...new Set([...properties, 'file']), '__custom__']) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value === '' ? 'Property' : value === '__custom__' ? 'Custom…' : value;
        property.append(option);
    }
    const update = () => {
        const isFile = typeInput.value.trim().toLowerCase() === 'file';
        form.dataset.fileAssociation = String(isFile);
        sources.hidden = !isFile;
        const local = isFile && mode === 'local';
        localInput.hidden = !local;
        localInput.required = local;
        valueInput.hidden = local;
        valueInput.required = !local;
        valueInput.placeholder = isFile ? 'Enter a URL (https:, file:, or another protocol)' : 'Choose or type a value';
        valueInput.setCustomValidity?.('');
        for (const button of sources.querySelectorAll('[data-file-mode]')) button.setAttribute('aria-checked', String(button.dataset.fileMode === mode));
    };
    property.addEventListener('change', () => {
        typeInput.hidden = property.value !== '__custom__';
        typeInput.value = property.value === '__custom__' ? '' : property.value;
        mode = 'link';
        typeInput.dispatchEvent(new Event('input'));
        update();
        if (!typeInput.hidden) typeInput.focus();
    });
    typeInput.addEventListener('input', update);
    for (const button of sources.querySelectorAll('[data-file-mode]')) button.addEventListener('click', () => {
        mode = button.dataset.fileMode;
        update();
        if (mode === 'local') localInput.click();
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!typeInput.value.trim()) return;
        const isFile = typeInput.value.trim().toLowerCase() === 'file';
        if (isFile && mode === 'link' && !validFileLink(valueInput.value.trim())) {
            valueInput.setCustomValidity('Enter a valid URL including its protocol, such as https: or file:.');
            valueInput.reportValidity();
            return;
        }
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
            const association = isFile && mode === 'local'
                ? await associationFromFile(localInput.files[0])
                : {type: typeInput.value, value: valueInput.value};
            await onAdd(association);
            localInput.value = '';
            valueInput.value = '';
        } catch (error) { window.alert(error.message); }
        finally { submit.disabled = false; }
    });
    valueInput.addEventListener('input', () => valueInput.setCustomValidity(''));
    update();
}
