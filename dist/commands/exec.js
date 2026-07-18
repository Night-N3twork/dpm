// `dpm exec <command>` — run a local-bin or temp-installed command.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import { installCommand } from './install.js';
import { error } from '../util/log.js';
const findLocalBin = (cwd, name) => {
    const bin = path.join(cwd, 'node_modules', '.bin', name);
    if (fs.existsSync(bin))
        return bin;
    // Walk up
    let dir = cwd;
    while (dir !== '/') {
        const candidate = path.join(dir, 'node_modules', '.bin', name);
        if (fs.existsSync(candidate))
            return candidate;
        dir = path.dirname(dir);
    }
    return null;
};
export const execCommand = async (opts) => {
    let binPath = findLocalBin(opts.cwd, opts.command);
    if (!binPath && opts.tempInstall) {
        // Install to a tmp dir and run
        const tmpDir = path.join('/tmp', `dpx-${Date.now()}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        const pkgName = opts.packageName ?? opts.command;
        await installCommand({
            cwd: tmpDir,
            packages: [pkgName],
            saveDev: false,
            silent: true,
        });
        binPath = findLocalBin(tmpDir, opts.command);
    }
    if (!binPath) {
        error(`Command not found: ${opts.command}`);
        return 127;
    }
    const result = child_process.spawnSync(binPath, opts.args, {
        cwd: opts.cwd,
        stdio: 'inherit',
        env: process.env,
    });
    return result.status ?? 1;
};
//# sourceMappingURL=exec.js.map