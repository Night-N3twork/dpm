// Lifecycle script runner.
import * as child_process from 'node:child_process';
import * as path from 'node:path';
import { warn } from '../util/log.js';
export const LIFECYCLE_ORDER = ['preinstall', 'install', 'postinstall', 'prepublish', 'prepare'];
export const runLifecycleScript = (pkg, scriptName, pkgDir, rootDir) => {
    const cmd = pkg.scripts?.[scriptName];
    if (!cmd)
        return 0;
    // Build env: PATH includes local node_modules/.bin, npm_* vars set
    const npmEnv = {
        npm_lifecycle_event: scriptName,
        npm_package_name: pkg.name ?? '',
        npm_package_version: pkg.version ?? '',
        INIT_CWD: rootDir,
    };
    for (const [k, v] of Object.entries(pkg.dependencies ?? {})) {
        npmEnv[`npm_package_dependencies_${k.replace(/[-@/]/g, '_')}`] = v;
    }
    const env = {
        ...process.env,
        ...npmEnv,
    };
    // Prepend local .bin to PATH
    const localBin = path.join(rootDir, 'node_modules', '.bin');
    env['PATH'] = `${localBin}:${env['PATH'] ?? ''}`;
    try {
        const result = child_process.spawnSync('/bin/sh', ['-c', cmd], {
            cwd: pkgDir,
            env,
            stdio: 'inherit',
        });
        return result.status ?? 0;
    }
    catch (e) {
        warn(`${scriptName} script failed:`, e.message);
        return 1;
    }
};
export const runLifecyclePhase = (pkg, phase, pkgDir, rootDir) => runLifecycleScript(pkg, phase, pkgDir, rootDir);
//# sourceMappingURL=scripts.js.map