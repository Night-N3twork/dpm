import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PackageJson } from '../types.js';

export interface LocalPackage {
  manifest: PackageJson;
  integrity: string;
}

const readFiles = (root: string, directory: string, hash: crypto.Hash): void => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules') continue;
    const source = path.join(directory, entry.name);
    const relative = path.relative(root, source).split(path.sep).join('/');
    if (entry.isSymbolicLink()) throw new Error(`Local package contains a symbolic link: ${source}`);
    if (entry.isDirectory()) {
      hash.update(`D\0${relative}\0`);
      readFiles(root, source, hash);
    } else if (entry.isFile()) {
      const bytes = fs.readFileSync(source);
      hash.update(`F\0${relative}\0`);
      const length = Buffer.allocUnsafe(8);
      length.writeBigUInt64BE(BigInt(bytes.length));
      hash.update(length);
      hash.update(bytes);
    } else {
      throw new Error(`Local package contains an unsupported entry: ${source}`);
    }
  }
};

export const readLocalPackage = (directory: string): LocalPackage => {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink()) throw new Error(`Local package is a symbolic link: ${directory}`);
  if (!stat.isDirectory()) throw new Error(`file: source is not a directory: ${directory}`);
  const manifestPath = path.join(directory, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PackageJson;
  if (!manifest.name || !manifest.version) throw new Error(`Local package has invalid package.json: ${manifestPath}`);
  const hash = crypto.createHash('sha512');
  readFiles(directory, directory, hash);
  return { manifest, integrity: `sha512-${hash.digest('base64')}` };
};
