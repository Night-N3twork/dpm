// Registry client and npm-style registry configuration.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Packument } from '../types.js';

export const OFFICIAL_REGISTRY = 'https://registry.dusk.night-x.com/';

export interface RegistryResolutionOptions {
  cwd: string;
  cliRegistry?: string;
  env?: Record<string, string | undefined>;
  home?: string;
  readFile?: (file: string) => string | null;
}

const readNpmrc = (file: string, readFile: (file: string) => string | null): Record<string, string> => {
  const text = readFile(file);
  if (text === null) return {};
  const config: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const equals = trimmed.indexOf('=');
    if (equals !== -1) config[trimmed.slice(0, equals).trim()] = trimmed.slice(equals + 1).trim();
  }
  return config;
};

const validateRegistry = (value: string): string => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
    return url.toString();
  } catch {
    throw new Error(`Invalid registry URL: ${value}`);
  }
};

export const resolveRegistry = (packageName: string, options: RegistryResolutionOptions): string => {
  const readFile = options.readFile ?? ((file: string) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
  const home = options.home ?? process.env.HOME ?? process.env.USERPROFILE ?? '/home/user';
  const config = { ...readNpmrc(path.join(home, '.npmrc'), readFile), ...readNpmrc(path.join(options.cwd, '.npmrc'), readFile) };
  const scope = packageName.startsWith('@') ? packageName.slice(0, packageName.indexOf('/')) : '';
  const scoped = Object.keys(config).filter((key) => key.endsWith(':registry') && scope === key.slice(0, -':registry'.length));
  if (scoped.length > 0) return validateRegistry(config[scoped.sort((a, b) => b.length - a.length)[0]!]!);
  const env = options.env ?? process.env;
  return validateRegistry(options.cliRegistry ?? env.DPM_REGISTRY ?? env.npm_config_registry ?? config.registry ?? OFFICIAL_REGISTRY);
};

export interface RegistryClient {
  readonly origin: string;
  getPackument(name: string): Promise<Packument>;
  getTarball(url: string): Promise<Uint8Array>;
}

export class RegistryResponseError extends Error {
  constructor(readonly status: number, readonly statusText: string, readonly url: string) {
    super(`fetch ${url}: ${status} ${statusText}`);
  }
}

const fetchBuffer = async (url: string, accept?: string): Promise<Uint8Array> => {
  const opts: RequestInit = {};
  if (accept) opts.headers = { 'Accept': accept };
  const res = await fetch(url, opts);
  if (!res.ok) {
    throw new RegistryResponseError(res.status, res.statusText, url);
  }
  return new Uint8Array(await res.arrayBuffer());
};

const fetchJson = async <T>(url: string, accept?: string): Promise<T> => {
  const opts: RequestInit = {};
  if (accept) opts.headers = { 'Accept': accept };
  const res = await fetch(url, opts);
  if (!res.ok) {
    throw new RegistryResponseError(res.status, res.statusText, url);
  }
  return await res.json() as T;
};

export const createRegistryClient = (registryUrl: string): RegistryClient => {
  const origin = validateRegistry(registryUrl);
  const base = origin.replace(/\/+$/, '');
  return {
    origin,
    async getPackument(name: string): Promise<Packument> {
      const url = `${base}/${encodeURIComponent(name).replace(/%2[fF]/g, '/')}`;
      return fetchJson<Packument>(url, 'application/vnd.npm.install-v1+json');
    },
    async getTarball(url: string): Promise<Uint8Array> {
      // Older DPM registries persisted root-relative URLs; retain the registry base path.
      const tarballURL = new URL(url.startsWith('/') ? url.slice(1) : url, origin).toString();
      return fetchBuffer(tarballURL);
    },
  };
};
