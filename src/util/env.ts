// Runtime detection — DuskJS vs Node.

export type Runtime = 'duskjs' | 'node';

export const detectRuntime = (): Runtime => {
  const g = globalThis as Record<string, unknown>;
  if (g['__DUSK_PID__'] !== undefined) return 'duskjs';
  return 'node';
};

export const isDuskJS = (): boolean => detectRuntime() === 'duskjs';

export const homeDir = (): string => {
  const g = globalThis as Record<string, unknown>;
  const proc = g['process'] as { env?: Record<string, string> } | undefined;
  return proc?.env?.['HOME'] ?? proc?.env?.['USERPROFILE'] ?? '/home/user';
};

export const defaultCacheDir = (): string => {
  return homeDir() + '/.dpm/cache';
};

export const defaultRegistry = (): string => {
  const g = globalThis as Record<string, unknown>;
  const proc = g['process'] as { env?: Record<string, string> } | undefined;
  return proc?.env?.['DPM_REGISTRY'] ?? 'https://registry.dusk.night-x.com/';
};
