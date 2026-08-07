import { expect, test } from 'vitest';
import { parseFlags } from '../src/cli/parse';

test('keeps the package following a boolean save flag positional', () => {
  expect(parseFlags(['--save', 'chalk'])).toEqual({
    positional: ['chalk'],
    flags: { save: true },
  });
});

test('consumes a value only for flags that accept values', () => {
  expect(parseFlags(['--registry', 'https://registry.example', 'chalk'])).toEqual({
    positional: ['chalk'],
    flags: { registry: 'https://registry.example' },
  });
});
