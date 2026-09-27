#!/usr/bin/env node
// npm — routes through dpm's npm-compatible command family.

import { main as dpmMain } from './dpm.js';

void dpmMain([process.argv[0]!, process.argv[1]!, 'npm', ...process.argv.slice(2)]).then((code) => {
  if (process.exit) process.exit(code);
});
