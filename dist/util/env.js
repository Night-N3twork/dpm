// Runtime detection — DuskJS vs Node.
export const detectRuntime = () => {
    const g = globalThis;
    if (g['__DUSK_PID__'] !== undefined)
        return 'duskjs';
    return 'node';
};
export const isDuskJS = () => detectRuntime() === 'duskjs';
export const homeDir = () => {
    const g = globalThis;
    const proc = g['process'];
    return proc?.env?.['HOME'] ?? proc?.env?.['USERPROFILE'] ?? '/home/user';
};
export const defaultCacheDir = () => {
    return homeDir() + '/.dpm/cache';
};
export const defaultRegistry = () => {
    const g = globalThis;
    const proc = g['process'];
    return proc?.env?.['DPM_REGISTRY'] ?? proc?.env?.['npm_config_registry'] ?? 'https://registry.npmjs.org';
};
//# sourceMappingURL=env.js.map