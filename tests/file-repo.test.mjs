import test from 'node:test';
import assert from 'node:assert/strict';
import { FileRepo } from '../js/file-repo.js';
import { createZip, readZip } from '../js/file-zip.js';

function storage() {
    const missing = () => Object.assign(new Error('Missing'), {name: 'NotFoundError'});
    function directory() {
        const children = new Map();
        return {kind: 'directory', children,
            async getDirectoryHandle(name, options = {}) {
                if (!children.has(name)) {
                    if (!options.create) throw missing();
                    children.set(name, directory());
                }
                return children.get(name);
            },
            async getFileHandle(name, options = {}) {
                if (!children.has(name)) {
                    if (!options.create) throw missing();
                    let data = new Blob();
                    children.set(name, {kind: 'file', getFile: async () => data, createWritable: async () => {
                        let pending;
                        return {write: async value => { pending = value instanceof Blob ? value : new Blob([value]); },
                            close: async () => { data = pending; }, abort: async () => {}};
                    }});
                }
                return children.get(name);
            },
            async *[Symbol.asyncIterator]() { yield* children; }
        };
    }
    const root = directory();
    return {getDirectory: async () => root};
}
const sample = (name, text) => new File([text], name, {type: 'text/markdown'});

test('OPFS FileRepo persists bytes, deduplicates by content and reopens from a new instance', async () => {
    const backend = storage();
    const repo = new FileRepo(backend);
    const metadata = await repo.put(sample('日本語.md', '# Hello'));
    assert.match(metadata.id, /^[a-f0-9]{64}$/);
    assert.equal(metadata.name, '日本語.md');
    assert.equal(await (await new FileRepo(backend).get(metadata.id)).text(), '# Hello');
    assert.equal((await repo.put(sample('copy.md', '# Hello'))).id, metadata.id);
    assert.equal((await repo.list()).length, 1);
    await assert.rejects(repo.get('bad'), /Invalid/);
    await assert.rejects(repo.get('f'.repeat(64)), /missing.*ZIP/i);
});

test('FileRepo ZIP exports and restores names, binary bytes and stable association IDs', async () => {
    const repo = new FileRepo(storage());
    const first = await repo.put(sample('日本語.md', '# Hello'));
    const second = await repo.put(new File([new Uint8Array([0, 255, 0, 100])], 'image.bin', {type: 'application/octet-stream'}));
    const zip = await repo.exportZip();
    assert.equal(zip.type, 'application/zip');
    const restored = new FileRepo(storage());
    assert.deepEqual(await restored.importZip(zip), {imported: 2});
    assert.deepEqual(await restored.list(), await repo.list());
    assert.equal(await (await restored.get(first.id)).text(), '# Hello');
    assert.deepEqual(new Uint8Array(await (await restored.get(second.id)).arrayBuffer()), new Uint8Array([0, 255, 0, 100]));
    assert.deepEqual(await restored.importZip(zip), {imported: 2});
    assert.equal((await restored.list()).length, 2);
});

test('damaged backups are rejected before any repository files are imported', async () => {
    const repo = new FileRepo(storage());
    const record = await repo.put(sample('note.md', '# Hello'));
    const entries = await readZip(await repo.exportZip());
    entries.set(`files/${record.id}`, new Blob(['damaged']));
    const damaged = await createZip([...entries].map(([name, data]) => ({name, data})));
    const restored = new FileRepo(storage());
    await assert.rejects(restored.importZip(damaged), /damaged/);
    assert.deepEqual(await restored.list(), []);
    await assert.rejects(restored.importZip(await createZip([{name: 'other.txt', data: new Blob(['hi'])}])), /FileRepo ZIP/);
});

test('ZIP parser rejects bad CRC, truncated archives and unsafe paths', async () => {
    const archive = await createZip([{name: 'hello.txt', data: new Blob(['hello'])}]);
    const bytes = new Uint8Array(await archive.arrayBuffer());
    bytes[30 + 'hello.txt'.length] ^= 1;
    await assert.rejects(readZip(new Blob([bytes])), /Invalid/);
    await assert.rejects(readZip(archive.slice(0, -5)), /Invalid/);
    await assert.rejects(readZip(new Blob([''])), /Invalid/);
    await assert.rejects(readZip(await createZip([{name: '../outside.txt', data: new Blob(['x'])}])), /Invalid/);
});

test('ZIP parser reads a DEFLATE archive produced by Python zipfile', async () => {
    const fixture = 'UEsDBBQAAAAIAFNaWl2FEUoNDQAAAAsAAAAJAAAAaGVsbG8udHh0y0jNyclXKM8vykkBAFBLAQIUAxQAAAAIAFNaWl2FEUoNDQAAAAsAAAAJAAAAAAAAAAAAAACAAQAAAABoZWxsby50eHRQSwUGAAAAAAEAAQA3AAAANAAAAAAA';
    const entries = await readZip(new Blob([Buffer.from(fixture, 'base64')]));
    assert.equal(await entries.get('hello.txt').text(), 'hello world');
});
