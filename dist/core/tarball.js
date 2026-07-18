// Tarball extraction: gunzip + ustar parsing.
//
// Layout:
//   1. Decompress gzip → raw tar bytes
//   2. Parse ustar headers (512-byte aligned records)
//   3. Write extracted files to disk
import * as zlib from 'node:zlib';
import * as fs from 'node:fs';
import * as path from 'node:path';
const decodeAscii = (bytes, start, len) => {
    let end = start + len;
    // Trim trailing nulls
    while (end > start && bytes[end - 1] === 0)
        end--;
    let s = '';
    for (let i = start; i < end; i++)
        s += String.fromCharCode(bytes[i]);
    return s;
};
const parseOctal = (bytes, start, len) => {
    const s = decodeAscii(bytes, start, len).trim();
    return s ? parseInt(s, 8) : 0;
};
export const parseTar = (bytes) => {
    const entries = [];
    let pos = 0;
    let pendingLongName;
    while (pos + 512 <= bytes.length) {
        // Check for empty block (end of archive)
        let isEmpty = true;
        for (let i = 0; i < 512; i++) {
            if (bytes[pos + i] !== 0) {
                isEmpty = false;
                break;
            }
        }
        if (isEmpty)
            break;
        let name = decodeAscii(bytes, pos, 100);
        const mode = parseOctal(bytes, pos + 100, 8);
        const size = parseOctal(bytes, pos + 124, 12);
        const typeflag = String.fromCharCode(bytes[pos + 156]);
        const prefix = decodeAscii(bytes, pos + 345, 155);
        if (prefix)
            name = prefix + '/' + name;
        if (pendingLongName) {
            name = pendingLongName;
            pendingLongName = undefined;
        }
        const dataStart = pos + 512;
        const dataEnd = dataStart + size;
        const paddedEnd = dataStart + Math.ceil(size / 512) * 512;
        const body = bytes.slice(dataStart, dataEnd);
        let type = 'other';
        if (typeflag === '0' || typeflag === '' || typeflag === '\0')
            type = 'file';
        else if (typeflag === '5')
            type = 'dir';
        else if (typeflag === '2')
            type = 'symlink';
        else if (typeflag === 'L')
            type = 'longname';
        else if (typeflag === 'K')
            type = 'longlink';
        if (type === 'longname') {
            pendingLongName = decodeAscii(body, 0, body.length).replace(/\0+$/, '');
            pos = paddedEnd;
            continue;
        }
        if (type === 'longlink') {
            pos = paddedEnd;
            continue;
        }
        entries.push({ name, size, type, mode, body });
        pos = paddedEnd;
    }
    return entries;
};
const ensureDir = (dir) => {
    try {
        fs.mkdirSync(dir, { recursive: true });
    }
    catch { /* */ }
};
// Extract tarball to a directory. `stripComponents` removes leading path
// components (typically 1 for npm tarballs, which have "package/" prefix).
export const extractTarball = async (tarballBytes, destDir, options = {}) => {
    // Try gunzip if the bytes look gzipped (magic 0x1f 0x8b)
    let tarBytes;
    if (tarballBytes[0] === 0x1f && tarballBytes[1] === 0x8b) {
        tarBytes = new Uint8Array(zlib.gunzipSync(tarballBytes));
    }
    else {
        tarBytes = tarballBytes;
    }
    const entries = parseTar(tarBytes);
    const strip = options.stripComponents ?? 0;
    ensureDir(destDir);
    for (const entry of entries) {
        let name = entry.name;
        if (name.includes('..'))
            continue; // safety
        if (strip > 0) {
            const parts = name.split('/');
            if (parts.length <= strip)
                continue;
            name = parts.slice(strip).join('/');
        }
        if (!name)
            continue;
        const fullPath = path.join(destDir, name);
        if (entry.type === 'dir') {
            ensureDir(fullPath);
            continue;
        }
        if (entry.type === 'file') {
            ensureDir(path.dirname(fullPath));
            fs.writeFileSync(fullPath, entry.body);
            // Best-effort mode
            try {
                fs.chmodSync(fullPath, entry.mode & 0o777);
            }
            catch { /* */ }
            continue;
        }
        // Skip symlinks for v1 — write as placeholder file with target
        if (entry.type === 'symlink') {
            // Skip
            continue;
        }
    }
};
//# sourceMappingURL=tarball.js.map