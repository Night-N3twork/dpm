#!/usr/bin/env node
// npx — alias for dpx.
import { main as dpxMain } from './dpx.js';
void dpxMain(process.argv).then((code) => {
    if (process.exit)
        process.exit(code);
});
//# sourceMappingURL=npx.js.map