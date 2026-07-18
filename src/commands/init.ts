// `dpm init` — interactive (or non-interactive --yes) package.json bootstrap.

import * as path from 'node:path';
import { writePackageJson, readPackageJson } from '../core/manifest.js';
import { info } from '../util/log.js';
import type { PackageJson } from '../types.js';

export interface InitOptions {
  cwd: string;
  yes?: boolean;
  name?: string;
}

export const initCommand = async (opts: InitOptions): Promise<number> => {
  const cwd = path.resolve(opts.cwd);
  let pkg: PackageJson = {};
  try { pkg = readPackageJson(cwd); } catch { /* */ }

  if (pkg.name && !opts.yes) {
    info(`package.json already exists for ${pkg.name}`);
    return 0;
  }

  const defaultName = opts.name ?? path.basename(cwd);
  const newPkg: PackageJson = {
    name: pkg.name ?? defaultName,
    version: pkg.version ?? '1.0.0',
    description: pkg.description ?? '',
    main: pkg.main ?? 'index.js',
    scripts: pkg.scripts ?? { test: 'echo "Error: no test specified" && exit 1' },
  };
  writePackageJson(cwd, newPkg);
  info(`Wrote ${path.join(cwd, 'package.json')}`);
  return 0;
};
