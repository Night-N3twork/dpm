// `dpm cache clean` / `cache verify`
import * as fs from 'node:fs';
import { defaultCacheDir } from '../util/env.js';
import { info } from '../util/log.js';
export const cacheCommand = async (subcommand, _args) => {
    const dir = defaultCacheDir();
    if (subcommand === 'clean') {
        if (fs.existsSync(dir))
            fs.rmSync(dir, { recursive: true, force: true });
        info(`Cache cleaned: ${dir}`);
        return 0;
    }
    if (subcommand === 'verify' || subcommand === 'ls') {
        info(`Cache directory: ${dir}`);
        if (!fs.existsSync(dir))
            info('(empty)');
        return 0;
    }
    info('Usage: dpm cache <clean|verify|ls>');
    return 1;
};
//# sourceMappingURL=cache.js.map