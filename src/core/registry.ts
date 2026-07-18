// Registry client — fetches packument and tarballs from registry.

import type { Packument } from '../types.js';

export interface RegistryClient {
  getPackument(name: string): Promise<Packument>;
  getTarball(url: string): Promise<Uint8Array>;
}

const fetchBuffer = async (url: string, accept?: string): Promise<Uint8Array> => {
  const opts: RequestInit = {};
  if (accept) opts.headers = { 'Accept': accept };
  const res = await fetch(url, opts);
  if (!res.ok) {
    throw new Error(`fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return new Uint8Array(await res.arrayBuffer());
};

const fetchJson = async <T>(url: string, accept?: string): Promise<T> => {
  const opts: RequestInit = {};
  if (accept) opts.headers = { 'Accept': accept };
  const res = await fetch(url, opts);
  if (!res.ok) {
    throw new Error(`fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return await res.json() as T;
};

export const createRegistryClient = (registryUrl: string): RegistryClient => {
  const base = registryUrl.replace(/\/+$/, '');
  return {
    async getPackument(name: string): Promise<Packument> {
      const url = `${base}/${encodeURIComponent(name).replace(/%2[fF]/g, '/')}`;
      return fetchJson<Packument>(url, 'application/vnd.npm.install-v1+json');
    },
    async getTarball(url: string): Promise<Uint8Array> {
      return fetchBuffer(url);
    },
  };
};
