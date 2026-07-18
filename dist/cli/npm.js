#!/usr/bin/env node
// npm — alias for dpm. Just forwards argv.
import { main as dpmMain } from './dpm.js';
void dpmMain(process.argv).then((code) => {
    if (process.exit)
        process.exit(code);
});
//# sourceMappingURL=npm.js.map