import { createZip, readZip } from './file-zip.js';

const validId = id => /^[a-f0-9]{64}$/.test(id);
const digest = async blob => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');

export class FileRepo {
    constructor(storage = null) { this.storage = storage; }

    async directory() {
        const storage = this.storage || globalThis.navigator?.storage;
        if (!storage?.getDirectory) throw new Error('Local files require OPFS storage. Open this app over HTTPS or localhost in a supported browser.');
        const root = await storage.getDirectory();
        const app = await root.getDirectoryHandle('taskimatic', {create: true});
        return app.getDirectoryHandle('FileRepo', {create: true});
    }

    async write(handle, data) {
        const stream = await handle.createWritable();
        try { await stream.write(data); await stream.close(); }
        catch (error) { try { await stream.abort(); } catch {} throw error; }
    }

    async put(file, metadata = {}) {
        if (!file || !Number.isSafeInteger(file.size) || file.size > 256 * 1024 * 1024) throw new Error('Choose a file no larger than 256 MB.');
        const root = await this.directory();
        const id = await digest(file);
        const record = {id, name: String(metadata.name || file.name || 'file').slice(0, 255),
            mime: String(metadata.mime || file.type || 'application/octet-stream').slice(0, 255), size: file.size};
        const save = async () => {
            const directory = await root.getDirectoryHandle(id, {create: true});
            // Commit metadata last; an interrupted write never appears in list().
            await this.write(await directory.getFileHandle('content', {create: true}), file);
            await this.write(await directory.getFileHandle('metadata.json', {create: true}), JSON.stringify(record));
        };
        if (globalThis.navigator?.locks) await navigator.locks.request(`taskimatic-file-${id}`, save);
        else await save();
        return record;
    }

    async get(id) {
        if (!validId(id)) throw new Error('Invalid FileRepo file ID.');
        try {
            const directory = await (await this.directory()).getDirectoryHandle(id);
            return (await directory.getFileHandle('content')).getFile();
        } catch (error) {
            if (error.name === 'NotFoundError') throw new Error('This file is missing from FileRepo. Import its FileRepo ZIP backup to restore it.');
            throw error;
        }
    }

    async list() {
        const files = [];
        for await (const [id, directory] of await this.directory()) {
            if (!validId(id) || directory.kind !== 'directory') continue;
            try {
                const metadata = JSON.parse(await (await (await directory.getFileHandle('metadata.json')).getFile()).text());
                const content = await (await directory.getFileHandle('content')).getFile();
                if (metadata.id === id && metadata.size === content.size) files.push(metadata);
            } catch (error) { if (error.name !== 'NotFoundError') throw error; }
        }
        return files.sort((a, b) => a.id.localeCompare(b.id));
    }

    async exportZip() {
        const files = await this.list();
        const entries = [{name: 'filerepo.json', data: new Blob([JSON.stringify({format: 'taskimatic-filerepo', version: 1, files})])}];
        for (const file of files) entries.push({name: `files/${file.id}`, data: await this.get(file.id)});
        return createZip(entries);
    }

    async importZip(archive) {
        const entries = await readZip(archive);
        const manifest = entries.get('filerepo.json');
        if (!manifest) throw new Error('Choose a FileRepo ZIP exported by Taskimatic.');
        const data = JSON.parse(await manifest.text());
        if (data.format !== 'taskimatic-filerepo' || data.version !== 1 || !Array.isArray(data.files)) throw new Error('Invalid FileRepo manifest.');
        const verified = [];
        const seen = new Set();
        // Validate every byte before changing the repository. Existing IDs stay valid.
        for (const record of data.files) {
            if (!record || !validId(record.id) || seen.has(record.id) || typeof record.name !== 'string' || typeof record.mime !== 'string') throw new Error('Invalid FileRepo file record.');
            seen.add(record.id);
            const content = entries.get(`files/${record.id}`);
            if (!content || record.size !== content.size || await digest(content) !== record.id) throw new Error(`FileRepo backup is damaged: ${record.name}`);
            verified.push({content, record});
        }
        for (const {content, record} of verified) await this.put(content, record);
        return {imported: verified.length};
    }
}

export const fileRepo = new FileRepo();
