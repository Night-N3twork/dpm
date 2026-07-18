#!/usr/bin/env node
// pnpm wrapper — translates pnpm-style argv into dpm equivalents.
//
// Translations:
//   pnpm install / pnpm i    →  dpm install
//   pnpm add <pkg>           →  dpm install <pkg>
//   pnpm add -D <pkg>        →  dpm install -D <pkg>
//   pnpm remove <pkg>        →  dpm uninstall <pkg>
//   pnpm run <script>        →  dpm run <script>
//   pnpm exec <cmd>          →  dpm exec <cmd>
//   pnpm dlx <pkg>           →  dpx <pkg>
//   pnpm list / pnpm ls      →  dpm list
//   pnpm init                →  dpm init

import { main as dpmMain } from './dpm.js';
import { main as dpxMain } from './dpx.js';

const translate = (argv: string[]): { handler: 'dpm' | 'dpx'; args: string[] } => {
  const args = argv.slice(2);
  if (args.length === 0) return { handler: 'dpm', args: argv };
  const sub = args[0]!;
  const rest = args.slice(1);

  switch (sub) {
    case 'install': case 'i':
      return { handler: 'dpm', args: [argv[0]!, argv[1]!, 'install', ...rest] };
    case 'add':
      return { handler: 'dpm', args: [argv[0]!, argv[1]!, 'install', ...rest] };
    case 'remove': case 'rm': case 'uninstall':
      return { handler: 'dpm', args: [argv[0]!, argv[1]!, 'uninstall', ...rest] };
    case 'run': case 'run-script':
      return { handler: 'dpm', args: [argv[0]!, argv[1]!, 'run', ...rest] };
    case 'exec':
      return { handler: 'dpm', args: [argv[0]!, argv[1]!, 'exec', ...rest] };
    case 'dlx':
      return { handler: 'dpx', args: [argv[0]!, argv[1]!, ...rest] };
    case 'list': case 'ls':
      return { handler: 'dpm', args: [argv[0]!, argv[1]!, 'list', ...rest] };
    case 'init':
      return { handler: 'dpm', args: [argv[0]!, argv[1]!, 'init', ...rest] };
    case 'cache':
      return { handler: 'dpm', args: [argv[0]!, argv[1]!, 'cache', ...rest] };
    case 'config':
      return { handler: 'dpm', args: [argv[0]!, argv[1]!, 'config', ...rest] };
    case '--version': case '-v':
      return { handler: 'dpm', args: [argv[0]!, argv[1]!, '--version'] };
    case '--help': case '-h':
      return { handler: 'dpm', args: [argv[0]!, argv[1]!, '--help'] };
    default:
      // Pass through unchanged; dpm will handle or error
      return { handler: 'dpm', args: argv };
  }
};

const main = async (): Promise<void> => {
  const { handler, args } = translate(process.argv);
  const fn = handler === 'dpx' ? dpxMain : dpmMain;
  const code = await fn(args);
  if (process.exit) process.exit(code);
};

void main();
