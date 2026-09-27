import { test, expect } from 'vitest';
import { computeIntegrity } from '../src/core/integrity';
import { lockedTarball, validateFrozenLockfile } from '../src/commands/install';

test('uses locked cache bytes only when their integrity matches', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const integrity = computeIntegrity(bytes);
  expect(lockedTarball(bytes, integrity)).toEqual(bytes);
  expect(lockedTarball(new Uint8Array([9]), integrity)).toBeNull();
});

test('rejects frozen lockfiles whose resolved root version misses its dependency range', () => {
  expect(() => validateFrozenLockfile({
    lockfileVersion: 3,
    requires: true,
    packages: { 'node_modules/widget': { version: '2.0.0' } },
  }, { widget: '^1.0.0' })).toThrow('Lockfile version 2.0.0 for widget does not satisfy ^1.0.0');
});

test('validates optional and peer roots in frozen lockfiles', () => {
  const lockfile = {
    lockfileVersion: 3 as const,
    requires: true as const,
    packages: {
      'node_modules/optional-widget': { version: '1.2.0' },
      'node_modules/peer-widget': { version: '3.1.0' },
    },
  };

  expect(() => validateFrozenLockfile(lockfile, {
    'optional-widget': '^1.0.0',
    'peer-widget': '^3.0.0',
  })).not.toThrow();
  expect(() => validateFrozenLockfile(lockfile, {
    'optional-widget': '^2.0.0',
    'peer-widget': '^4.0.0',
  })).toThrow('Lockfile version 1.2.0 for optional-widget does not satisfy ^2.0.0');
});
