// Small, dependency-free ZIP codec. Exports STORE entries; imports STORE and
// DEFLATE entries (including ZIPs recompressed by standard archive tools).
const MAX_BYTES = 256 * 1024 * 1024;
const crcTable = Array.from({length: 256}, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});
function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
function header(size) { const bytes = new Uint8Array(size); return {bytes, view: new DataView(bytes.buffer)}; }

export async function createZip(entries) {
    const encoder = new TextEncoder();
    if (entries.length > 10000) throw new Error('FileRepo has too many files for one ZIP.');
    const chunks = [], central = [];
    let offset = 0, centralSize = 0;
    for (const entry of entries) {
        const name = encoder.encode(entry.name);
        if (offset + centralSize + 30 + 46 + 2 * name.length + entry.data.size + 22 > MAX_BYTES) throw new Error('FileRepo ZIP exports are limited to 256 MB.');
        const bytes = new Uint8Array(await entry.data.arrayBuffer());
        if (offset + bytes.length > MAX_BYTES) throw new Error('FileRepo ZIP exports are limited to 256 MB.');
        const crc = crc32(bytes);
        const local = header(30);
        local.view.setUint32(0, 0x04034b50, true);
        local.view.setUint16(4, 20, true);
        local.view.setUint16(6, 0x800, true);
        local.view.setUint32(14, crc, true);
        local.view.setUint32(18, bytes.length, true);
        local.view.setUint32(22, bytes.length, true);
        local.view.setUint16(26, name.length, true);
        const directory = header(46);
        directory.view.setUint32(0, 0x02014b50, true);
        directory.view.setUint16(4, 20, true);
        directory.view.setUint16(6, 20, true);
        directory.view.setUint16(8, 0x800, true);
        directory.view.setUint32(16, crc, true);
        directory.view.setUint32(20, bytes.length, true);
        directory.view.setUint32(24, bytes.length, true);
        directory.view.setUint16(28, name.length, true);
        directory.view.setUint32(42, offset, true);
        chunks.push(local.bytes, name, bytes);
        central.push(directory.bytes, name);
        offset += 30 + name.length + bytes.length;
        centralSize += 46 + name.length;
    }
    const end = header(22);
    end.view.setUint32(0, 0x06054b50, true);
    end.view.setUint16(8, entries.length, true);
    end.view.setUint16(10, entries.length, true);
    end.view.setUint32(12, centralSize, true);
    end.view.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, end.bytes], {type: 'application/zip'});
}

export async function readZip(blob) {
    const decoder = new TextDecoder('utf-8', {fatal: true});
    if (blob.size > MAX_BYTES) throw new Error('FileRepo ZIP imports are limited to 256 MB.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const fail = () => { throw new Error('Invalid or unsupported ZIP archive.'); };
    let end = bytes.length - 22;
    while (end >= Math.max(0, bytes.length - 65557)) {
        if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
        end--;
    }
    if (end < 0 || end < bytes.length - 65557) fail();
    const count = view.getUint16(end + 10, true);
    if (count > 10000 || view.getUint32(end + 4, true) !== 0 || view.getUint16(end + 8, true) !== count) fail();
    const centralEnd = view.getUint32(end + 16, true) + view.getUint32(end + 12, true);
    let cursor = view.getUint32(end + 16, true), total = 0;
    if (centralEnd !== end) fail();
    const entries = new Map();
    for (let index = 0; index < count; index++) {
        if (cursor + 46 > centralEnd || view.getUint32(cursor, true) !== 0x02014b50) fail();
        const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
        const crc = view.getUint32(cursor + 16, true), compressed = view.getUint32(cursor + 20, true), size = view.getUint32(cursor + 24, true);
        const nameLength = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true);
        const local = view.getUint32(cursor + 42, true);
        if (flags & 1 || ![0, 8].includes(method) || cursor + 46 + nameLength + extra + comment > centralEnd || local + 30 > view.getUint32(end + 16, true)) fail();
        const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
        if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || entries.has(name)) fail();
        if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 8, true) !== method) fail();
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        if (start + compressed > view.getUint32(end + 16, true) || (total += size) > MAX_BYTES) fail();
        let content = bytes.slice(start, start + compressed);
        if (method === 8) {
            const stream = new Blob([content]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            const reader = stream.getReader(), chunks = [];
            let length = 0;
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                length += value.length;
                if (length > size) { await reader.cancel(); fail(); }
                chunks.push(value);
            }
            content = new Uint8Array(await new Blob(chunks).arrayBuffer());
        }
        if (content.length !== size || crc32(content) !== crc) fail();
        if (!name.endsWith('/')) entries.set(name, new Blob([content]));
        cursor += 46 + nameLength + extra + comment;
    }
    if (cursor !== centralEnd) fail();
    return entries;
}
