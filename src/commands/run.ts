// `dpm run <script>` — run a package.json script.

import * as path from 'node:path';
import * as child_process from 'node:child_process';
import { readPackageJson } from '../core/manifest.js';
import { error } from '../util/log.js';

export interface RunOptions {
  cwd: string;
  script: string;
  args: string[];
}

export const runCommand = async (opts: RunOptions): Promise<number> => {
  const cwd = path.resolve(opts.cwd);
  const pkg = readPackageJson(cwd);
  const cmd = pkg.scripts?.[opts.script];
  if (!cmd) {
    error(`Script not found: ${opts.script}`);
    return 1;
  }
  const binDir = path.join(cwd, 'node_modules', '.bin');
  const fullCmd = opts.args.length > 0 ? `${cmd} ${opts.args.join(' ')}` : cmd;
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    npm_lifecycle_event: opts.script,
    npm_package_name: pkg.name ?? '',
    npm_package_version: pkg.version ?? '',
  };
  env['PATH'] = `${binDir}:${env['PATH'] ?? ''}`;

  const result = child_process.spawnSync('/bin/sh', ['-c', fullCmd], {
    cwd,
    env,
    stdio: 'inherit',
  });
  return result.status ?? 1;
};
