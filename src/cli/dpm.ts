#!/usr/bin/env node
// dpm CLI dispatcher.

import { installCommand } from '../commands/install.js';
import { uninstallCommand } from '../commands/uninstall.js';
import { runCommand } from '../commands/run.js';
import { listCommand } from '../commands/list.js';
import { initCommand } from '../commands/init.js';
import { execCommand } from '../commands/exec.js';
import { cacheCommand } from '../commands/cache.js';
import { configCommand } from '../commands/config.js';
import { setSilent } from '../util/log.js';
import { parseFlags } from './args.js';

const NPM_REGISTRY = 'https://registry.npmjs.org/';

const HELP = `dpm — Dusk Package Manager

Usage:
  dpm install [packages...]     Install dependencies (alias: dpm i, dpm add)
  dpm npm install [packages...] Install npm packages from npmjs
  dpm uninstall <pkg>           Remove a package (alias: dpm rm, dpm remove)
  dpm run <script> [args...]    Run a package.json script
  dpm exec <command> [args...]  Run a local-bin command
  dpm list                      List installed packages
  dpm init [--yes]              Initialize a new package.json
  dpm cache <clean|verify|ls>   Manage the cache
  dpm config <get|set|delete> .. Manage config
  dpm publish [args...]          Publishing is not available yet
  dpm --version                 Print dpm version
  dpm --help                    Show this help

Options:
  -D, --save-dev                Save to devDependencies
  -S, --save                    Save to dependencies (default)
  --silent                      Suppress output
  --registry <url>              Override the selected DPM or npm registry
  --frozen-lockfile             Require the existing lockfile and verified cache
  --offline                     Install only verified cached lockfile artifacts
  --no-npm-fallback             Disable npm fallback for direct installs
`;

export const main = async (argv: string[]): Promise<number> => {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (args[0] === '--version' || args[0] === '-v') {
    process.stdout.write('0.1.0\n');
    return 0;
  }

  const sub = args[0]!;
  const rest = args.slice(1);
  const { positional, flags } = parseFlags(rest);
  if (flags['silent']) setSilent(true);
  const cwd = (flags['cwd'] as string) ?? process.cwd();

  try {
    switch (sub) {
      case 'install': case 'i': case 'add':
        return await installCommand({
          cwd,
          packages: positional,
          saveDev: !!flags['save-dev'] || !!flags['D'],
          ...(flags['registry'] ? { registry: flags['registry'] as string } : {}),
          noScripts: !!flags['ignore-scripts'],
          frozenLockfile: !!flags['frozen-lockfile'],
           offline: !!flags['offline'],
           npmFallback: !flags['no-npm-fallback'],
          silent: !!flags['silent'],
        });
      case 'npm':
        if (positional[0] === 'install' || positional[0] === 'i' || positional[0] === 'add') {
          return await installCommand({
            cwd,
            packages: positional.slice(1),
            saveDev: !!flags['save-dev'] || !!flags['D'],
            registry: (flags['registry'] as string | undefined) ?? NPM_REGISTRY,
            noScripts: !!flags['ignore-scripts'],
            frozenLockfile: !!flags['frozen-lockfile'],
            offline: !!flags['offline'],
            npmFallback: false,
            silent: !!flags['silent'],
          });
        }
        process.stderr.write(`dpm npm: unsupported command '${positional[0] ?? ''}'\n`);
        return 1;
      case 'uninstall': case 'rm': case 'remove': case 'un':
        return await uninstallCommand({ cwd, packages: positional });
      case 'run': case 'run-script':
        if (positional.length === 0) { process.stderr.write('dpm run: missing script name\n'); return 1; }
        return await runCommand({ cwd, script: positional[0]!, args: positional.slice(1) });
      case 'exec':
        if (positional.length === 0) { process.stderr.write('dpm exec: missing command\n'); return 1; }
        return await execCommand({ cwd, command: positional[0]!, args: positional.slice(1) });
      case 'list': case 'ls':
        return await listCommand({ cwd });
      case 'init':
        return await initCommand({ cwd, yes: !!flags['yes'] || !!flags['y'] });
      case 'cache':
        if (positional.length === 0) { process.stderr.write('dpm cache: missing subcommand\n'); return 1; }
        return await cacheCommand(positional[0]!, positional.slice(1));
      case 'config':
        if (positional.length === 0) { process.stderr.write('dpm config: missing subcommand\n'); return 1; }
        return await configCommand(positional[0]!, positional.slice(1));
      case 'publish':
        // TODO: add the authenticated official registry publishing interface.
        process.stderr.write('dpm publish: publishing is not available yet\n');
        return 1;
      default:
        process.stderr.write(`dpm: unknown command '${sub}'\n`);
        process.stderr.write(HELP);
        return 1;
    }
  } catch (e) {
    process.stderr.write(`dpm: ${(e as Error).message}\n`);
    return 1;
  }
};

// Execute when invoked directly
if (typeof process !== 'undefined' && process.argv) {
  const run = main(process.argv).then((code) => {
    if (process.exit) process.exit(code);
  }).catch((e) => {
    process.stderr.write(`dpm: ${(e as Error).message}\n`);
    if (process.exit) process.exit(1);
  });
  const duskProcess = (globalThis as typeof globalThis & {
    __process?: { _exitReserved?: boolean; __mainPromise?: Promise<void> };
  }).__process;
  if (duskProcess) {
    duskProcess._exitReserved = true;
    duskProcess.__mainPromise = run;
  }
}
