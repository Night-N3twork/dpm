#!/usr/bin/env node
// dpx — execute a package binary, installing it temporarily if not available locally.

import * as path from 'node:path';
import { execCommand } from '../commands/exec.js';

export const main = async (argv: string[]): Promise<number> => {
  const args = argv.slice(2);
  let packageName: string | undefined;
  let command: string | undefined;
  let restArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-p' || a === '--package') {
      packageName = args[++i];
      continue;
    }
    if (a === '--') {
      restArgs = args.slice(i + 1);
      break;
    }
    if (a.startsWith('-')) continue;
    command = a;
    restArgs = args.slice(i + 1);
    break;
  }

  if (!command) {
    process.stderr.write('Usage: dpx [-p <pkg>] <command> [args...]\n');
    return 1;
  }

  const opts: Parameters<typeof execCommand>[0] = {
    cwd: process.cwd(),
    command,
    args: restArgs,
    tempInstall: true,
  };
  if (packageName) opts.packageName = packageName;
  return await execCommand(opts);
};

if (typeof process !== 'undefined' && process.argv) {
  void main(process.argv).then((code) => {
    if (process.exit) process.exit(code);
  });
}

void path;
