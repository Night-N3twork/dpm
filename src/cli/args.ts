export const parseFlags = (args: string[]): { positional: string[]; flags: Record<string, string | boolean> } => {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const booleanFlags = new Set(['silent', 'save-dev', 'D', 'ignore-scripts', 'frozen-lockfile', 'offline', 'no-npm-fallback', 'yes', 'y']);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--') { positional.push(...args.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (booleanFlags.has(a.slice(2))) {
        flags[a.slice(2)] = true;
      } else {
        const next = args[i + 1];
        if (next && !next.startsWith('-')) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else if (a.startsWith('-')) {
      flags[a.slice(1)] = true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
};
