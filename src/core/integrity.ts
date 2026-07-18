// Tarball integrity verification.
// Supports "sha512-<base64>" SRI format and "sha1" shasums.

import * as crypto from 'node:crypto';

export const verifyIntegrity = (bytes: Uint8Array, integrity: string): boolean => {
  if (integrity.startsWith('sha512-')) {
    const expected = integrity.slice(7);
    const hash = crypto.createHash('sha512').update(bytes).digest('base64');
    return hash === expected;
  }
  if (integrity.startsWith('sha256-')) {
    const expected = integrity.slice(7);
    const hash = crypto.createHash('sha256').update(bytes).digest('base64');
    return hash === expected;
  }
  if (integrity.startsWith('sha1-')) {
    const expected = integrity.slice(5);
    const hash = crypto.createHash('sha1').update(bytes).digest('base64');
    return hash === expected;
  }
  // Hex shasum (legacy)
  if (/^[0-9a-f]{40}$/i.test(integrity)) {
    const hash = crypto.createHash('sha1').update(bytes).digest('hex');
    return hash === integrity.toLowerCase();
  }
  return false;
};

export const computeIntegrity = (bytes: Uint8Array, algorithm: 'sha1' | 'sha256' | 'sha512' = 'sha512'): string => {
  const hash = crypto.createHash(algorithm).update(bytes).digest('base64');
  return `${algorithm}-${hash}`;
};
