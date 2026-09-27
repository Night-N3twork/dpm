import { expect, test } from 'vitest';
import { parseFlags } from '../src/cli/args';

test('keeps the package after --no-npm-fallback positional', () => {
  expect(parseFlags(['--no-npm-fallback', 'dpm-tar'])).toEqual({
    positional: ['dpm-tar'],
    flags: { 'no-npm-fallback': true },
  });
});
