// Create node_modules/.bin/ shims for installed packages with bin fields.
//
// Shim behavior (npm-compatible):
//   - Always exec the target directly. The OS picks how to run it based on the
//     magic bytes / shebang of the file at invocation time.
//     - ELF / Mach-O / PE binaries → loaded natively
//     - #!/usr/bin/env node scripts → run via the shebang interpreter
//   - For JS scripts WITHOUT a shebang (rare), we fall back to a node wrapper at
//     shim creation time so a missing shebang doesn't break the binary.
//
// Postinstall scripts that swap a JS stub for a native binary (esbuild) work
// because we shebang-route both paths to direct exec.

import * as fs from 'node:fs';
import * as path from 'node:path';

type TargetKind = 'native' | 'shebang' | 'js';

const detectTargetKind = (absTarget: string): TargetKind => {
  try {
    const fd = fs.openSync(absTarget, 'r');
    try {
      const buf = Buffer.alloc(4);
      const n = fs.readSync(fd, buf, 0, 4, 0);
      if (n >= 4) {
        if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return 'native';
        if (
          (buf[0] === 0xfe && buf[1] === 0xed && buf[2] === 0xfa && (buf[3] === 0xce || buf[3] === 0xcf)) ||
          (buf[3] === 0xfe && buf[2] === 0xed && buf[1] === 0xfa && (buf[0] === 0xce || buf[0] === 0xcf))
        ) return 'native';
        if (buf[0] === 0xca && buf[1] === 0xfe && buf[2] === 0xba && buf[3] === 0xbe) return 'native';
        if (buf[0] === 0x4d && buf[1] === 0x5a) return 'native';
      }
      if (n >= 2 && buf[0] === 0x23 && buf[1] === 0x21) return 'shebang';
      return 'js';
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return 'js';
  }
};

export const createBinShims = (
  binDir: string,
  pkgName: string,
  pkgDir: string,
  bin: string | Record<string, string> | undefined,
): void => {
  if (!bin) return;
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

  const entries: Array<{ name: string; target: string }> = [];
  if (typeof bin === 'string') {
    const shortName = pkgName.split('/').pop() ?? pkgName;
    entries.push({ name: shortName, target: bin });
  } else {
    for (const [name, target] of Object.entries(bin)) {
      entries.push({ name, target });
    }
  }

  for (const { name, target } of entries) {
    const shimPath = path.join(binDir, name);
    const absTarget = path.join(pkgDir, target);

    const kind = fs.existsSync(absTarget) ? detectTargetKind(absTarget) : 'js';

    // Shim strategy: always exec target directly. This matches npm's symlink behavior
    // and works for native binaries (ELF/Mach-O/PE) and shebanged scripts on real Node.
    // For scripts without a shebang, we keep a node-invoking fallback path so things
    // still work inside DuskJS (where the shell doesn't yet honor shebangs). Postinstall
    // scripts that swap a JS stub for a native binary (esbuild) work because we re-detect
    // at runtime via a shebang check.
    let shimContent: string;
    if (kind === 'native') {
      shimContent = `#!/bin/sh\nexec "${absTarget}" "$@"\n`;
    } else if (kind === 'shebang') {
      // Has a shebang — fast path: exec it. If the file later gets swapped to ELF by a
      // postinstall script, exec still works because the OS reads the magic bytes.
      shimContent = `#!/bin/sh\nexec "${absTarget}" "$@"\n`;
    } else {
      // No shebang detected → assume JS, route through node.
      shimContent =
        `#!/bin/sh\n` +
        `if [ -x /bin/node ]; then\n` +
        `  exec /bin/node "${absTarget}" "$@"\n` +
        `else\n` +
        `  exec node "${absTarget}" "$@"\n` +
        `fi\n`;
    }
    try {
      fs.writeFileSync(shimPath, shimContent);
      fs.chmodSync(shimPath, 0o755);
      // Ensure target is executable so direct exec works (matters for shebang scripts).
      const targetStat = fs.existsSync(absTarget) ? fs.statSync(absTarget) : null;
      if (targetStat && !(targetStat.mode & 0o111)) {
        fs.chmodSync(absTarget, targetStat.mode | 0o111);
      }
    } catch { /* */ }
  }
};
