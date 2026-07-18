// `dpm list` — print installed dependency tree.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readPackageJson } from '../core/manifest.js';
import { log } from '../util/log.js';
export const listCommand = async (opts) => {
    const cwd = path.resolve(opts.cwd);
    const pkg = readPackageJson(cwd);
    const depth = opts.depth ?? 0;
    log(`${pkg.name ?? '<no name>'}@${pkg.version ?? '<no version>'} ${cwd}`);
    const nodeModules = path.join(cwd, 'node_modules');
    if (!fs.existsSync(nodeModules)) {
        log('(no node_modules)');
        return 0;
    }
    const printTree = (dir, indent) => {
        if (depth > 0 && indent > depth)
            return;
        const entries = fs.readdirSync(dir).filter((e) => !e.startsWith('.'));
        for (const entry of entries) {
            const subPath = path.join(dir, entry);
            const stat = fs.statSync(subPath);
            if (!stat.isDirectory())
                continue;
            // Handle scoped packages
            if (entry.startsWith('@')) {
                const scopedEntries = fs.readdirSync(subPath);
                for (const inner of scopedEntries) {
                    const innerPath = path.join(subPath, inner);
                    const innerStat = fs.statSync(innerPath);
                    if (!innerStat.isDirectory())
                        continue;
                    try {
                        const sub = readPackageJson(innerPath);
                        log(`${'  '.repeat(indent + 1)}${entry}/${inner}@${sub.version ?? '?'}`);
                    }
                    catch { /* */ }
                }
            }
            else {
                try {
                    const sub = readPackageJson(subPath);
                    log(`${'  '.repeat(indent + 1)}${entry}@${sub.version ?? '?'}`);
                }
                catch { /* */ }
            }
        }
    };
    printTree(nodeModules, 0);
    return 0;
};
//# sourceMappingURL=list.js.map