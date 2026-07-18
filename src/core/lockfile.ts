// package-lock.json v3 read/write.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LockfileV3, ResolvedDep } from '../types.js';

export const readLockfile = (cwd: string): LockfileV3 | null => {
  const p = path.join(cwd, 'package-lock.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as LockfileV3;
  } catch {
    return null;
  }
};

export const writeLockfile = (cwd: string, lockfile: LockfileV3): void => {
  const p = path.join(cwd, 'package-lock.json');
  fs.writeFileSync(p, JSON.stringify(lockfile, null, 2) + '\n');
};

export const buildLockfile = (
  pkgName: string | undefined,
  pkgVersion: string | undefined,
  rootDeps: Record<string, string>,
  rootDevDeps: Record<string, string>,
  resolved: Map<string, ResolvedDep>,
): LockfileV3 => {
  const packages: LockfileV3['packages'] = {};
  packages[''] = {
    ...(pkgName !== undefined ? { name: pkgName } : {}),
    ...(pkgVersion !== undefined ? { version: pkgVersion } : {}),
    ...(Object.keys(rootDeps).length > 0 ? { dependencies: rootDeps } : {}),
    ...(Object.keys(rootDevDeps).length > 0 ? { devDependencies: rootDevDeps } : {}),
  };
  for (const [installPath, dep] of resolved) {
    // installPath is already in the npm package-lock v3 form ("node_modules/foo"
    // or "node_modules/vite/node_modules/rolldown")
    const key = installPath;
    const subDeps: Record<string, string> = {};
    for (const [d, dr] of Object.entries(dep.dependencies)) subDeps[d] = dr;
    packages[key] = {
      version: dep.version,
      resolved: dep.tarballUrl,
      ...(dep.integrity !== undefined ? { integrity: dep.integrity } : {}),
      ...(dep.isDev ? { dev: true } : {}),
      ...(Object.keys(subDeps).length > 0 ? { dependencies: subDeps } : {}),
    };
  }
  const lockfile: LockfileV3 = {
    lockfileVersion: 3,
    requires: true,
    packages,
  };
  if (pkgName !== undefined) lockfile.name = pkgName;
  if (pkgVersion !== undefined) lockfile.version = pkgVersion;
  return lockfile;
};
