// Content-addressable cache, npm-compatible layout.
// Files stored at: <cacheDir>/sha512/AA/BB/<full-hex>

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const ensureDir = (dir: string): void => {
  try { fs.mkdirSync(dir, { recursive: true }); }
  catch { /* */ }
};

export interface Cache {
  has(integrity: string): boolean;
  read(integrity: string): Uint8Array | null;
  write(integrity: string, bytes: Uint8Array): void;
  pathFor(integrity: string): string;
}

const decodeIntegrity = (integrity: string): { alg: string; hash: string } | null => {
  const dash = integrity.indexOf('-');
  if (dash === -1) return null;
  return { alg: integrity.slice(0, dash), hash: integrity.slice(dash + 1) };
};

const hashHex = (bytes: Uint8Array, alg: string): string => {
  return crypto.createHash(alg).update(bytes).digest('hex');
};

const computeHexFromIntegrity = (integrity: string): string => {
  // Convert base64 SRI to hex for filesystem layout
  const decoded = decodeIntegrity(integrity);
  if (!decoded) return integrity.replace(/[^0-9a-fA-F]/g, '');
  // The integrity hash is base64 encoded; convert to hex
  try {
    const buf = Buffer.from(decoded.hash, 'base64');
    return buf.toString('hex');
  } catch {
    return decoded.hash.replace(/[^0-9a-fA-F]/g, '');
  }
};

export const createCache = (cacheDir: string): Cache => {
  return {
    pathFor(integrity: string): string {
      const decoded = decodeIntegrity(integrity);
      const alg = decoded?.alg ?? 'sha512';
      const hex = computeHexFromIntegrity(integrity);
      const shard1 = hex.slice(0, 2);
      const shard2 = hex.slice(2, 4);
      return path.join(cacheDir, alg, shard1, shard2, hex);
    },
    has(integrity: string): boolean {
      try { return fs.existsSync(this.pathFor(integrity)); }
      catch { return false; }
    },
    read(integrity: string): Uint8Array | null {
      try {
        const p = this.pathFor(integrity);
        if (!fs.existsSync(p)) return null;
        return new Uint8Array(fs.readFileSync(p));
      } catch { return null; }
    },
    write(integrity: string, bytes: Uint8Array): void {
      const p = this.pathFor(integrity);
      ensureDir(path.dirname(p));
      fs.writeFileSync(p, bytes);
    },
  };
};

export const computeShasumIntegrity = (bytes: Uint8Array, algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha512'): string => {
  const hash = crypto.createHash(algorithm).update(bytes).digest('base64');
  return `${algorithm}-${hash}`;
};

export { hashHex };
