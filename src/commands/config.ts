// `dpm config get/set/delete <key> [value]`

import * as fs from 'node:fs';
import * as path from 'node:path';
import { homeDir } from '../util/env.js';
import { info } from '../util/log.js';

const configPath = (): string => path.join(homeDir(), '.dpmrc');

const readConfig = (): Record<string, string> => {
  const p = configPath();
  if (!fs.existsSync(p)) return {};
  const out: Record<string, string> = {};
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
};

const writeConfig = (config: Record<string, string>): void => {
  const p = configPath();
  const text = Object.entries(config).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(p, text);
};

export const configCommand = async (subcommand: string, args: string[]): Promise<number> => {
  const config = readConfig();
  if (subcommand === 'get') {
    const [key] = args;
    if (!key) { info('Usage: dpm config get <key>'); return 1; }
    info(config[key] ?? '');
    return 0;
  }
  if (subcommand === 'set') {
    const [key, value] = args;
    if (!key || value === undefined) { info('Usage: dpm config set <key> <value>'); return 1; }
    config[key] = value;
    writeConfig(config);
    return 0;
  }
  if (subcommand === 'delete' || subcommand === 'rm') {
    const [key] = args;
    if (!key) { info('Usage: dpm config delete <key>'); return 1; }
    delete config[key];
    writeConfig(config);
    return 0;
  }
  if (subcommand === 'list' || subcommand === 'ls') {
    for (const [k, v] of Object.entries(config)) info(`${k}=${v}`);
    return 0;
  }
  info('Usage: dpm config <get|set|delete|list> ...');
  return 1;
};
