// package.json read/write helpers.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PackageJson } from '../types.js';

export const readPackageJson = (cwd: string): PackageJson => {
  const p = path.join(cwd, 'package.json');
  if (!fs.existsSync(p)) return {};
  let content: string;
  try {
    content = fs.readFileSync(p, 'utf8');
  } catch {
    return {};
  }
  if (content.trim() === '') return {};
  try {
    return JSON.parse(content) as PackageJson;
  } catch (e) {
    throw new Error(`Cannot parse ${p}: ${(e as Error).message}`);
  }
};

export const writePackageJson = (cwd: string, pkg: PackageJson): void => {
  const p = path.join(cwd, 'package.json');
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
};

export const findPackageRoot = (cwd: string): string => {
  let dir = cwd;
  for (let i = 0; i < 32; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd;
};

export const mergeDep = (pkg: PackageJson, name: string, version: string, dev: boolean): void => {
  if (dev) {
    pkg.devDependencies = pkg.devDependencies ?? {};
    pkg.devDependencies[name] = version;
    if (pkg.dependencies) delete pkg.dependencies[name];
  } else {
    pkg.dependencies = pkg.dependencies ?? {};
    pkg.dependencies[name] = version;
    if (pkg.devDependencies) delete pkg.devDependencies[name];
  }
};

export const removeDep = (pkg: PackageJson, name: string): void => {
  if (pkg.dependencies) delete pkg.dependencies[name];
  if (pkg.devDependencies) delete pkg.devDependencies[name];
  if (pkg.peerDependencies) delete pkg.peerDependencies[name];
  if (pkg.optionalDependencies) delete pkg.optionalDependencies[name];
};

export const allDeps = (pkg: PackageJson, includeDev = true): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(pkg.dependencies ?? {})) out[k] = v;
  if (includeDev) for (const [k, v] of Object.entries(pkg.devDependencies ?? {})) out[k] = v;
  return out;
};
