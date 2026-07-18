// `dpm uninstall <pkg>` — remove a package.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readPackageJson, writePackageJson, removeDep } from '../core/manifest.js';
import { info } from '../util/log.js';
export const uninstallCommand = async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const pkg = readPackageJson(cwd);
    for (const name of opts.packages) {
        removeDep(pkg, name);
        const pkgPath = path.join(cwd, 'node_modules', name);
        if (fs.existsSync(pkgPath)) {
            fs.rmSync(pkgPath, { recursive: true, force: true });
            info(`removed ${name}`);
        }
    }
    writePackageJson(cwd, pkg);
    return 0;
};
//# sourceMappingURL=uninstall.js.map