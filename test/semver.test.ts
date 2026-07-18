import { test, expect } from 'vitest';
import * as semver from '../src/semver/index';

test('semver parse basic', () => {
  const v = semver.parse('1.2.3');
  expect(v).not.toBeNull();
  expect(v!.major).toBe(1);
  expect(v!.minor).toBe(2);
  expect(v!.patch).toBe(3);
});

test('semver parse with prerelease', () => {
  const v = semver.parse('1.2.3-beta.4');
  expect(v).not.toBeNull();
  expect(v!.prerelease).toEqual(['beta', '4']);
});

test('semver valid', () => {
  expect(semver.valid('1.0.0')).toBe(true);
  expect(semver.valid('1.0')).toBe(false);
  expect(semver.valid('garbage')).toBe(false);
});

test('semver compare', () => {
  expect(semver.compare('1.0.0', '1.0.1')).toBe(-1);
  expect(semver.compare('2.0.0', '1.9.9')).toBe(1);
  expect(semver.compare('1.0.0', '1.0.0')).toBe(0);
  expect(semver.compare('1.0.0-beta', '1.0.0')).toBe(-1);
});

test('semver satisfies exact', () => {
  expect(semver.satisfies('1.0.0', '1.0.0')).toBe(true);
  expect(semver.satisfies('1.0.0', '1.0.1')).toBe(false);
});

test('semver satisfies caret', () => {
  expect(semver.satisfies('1.2.3', '^1.0.0')).toBe(true);
  expect(semver.satisfies('1.9.9', '^1.0.0')).toBe(true);
  expect(semver.satisfies('2.0.0', '^1.0.0')).toBe(false);
});

test('semver satisfies tilde', () => {
  expect(semver.satisfies('1.2.5', '~1.2.0')).toBe(true);
  expect(semver.satisfies('1.3.0', '~1.2.0')).toBe(false);
});

test('semver satisfies range', () => {
  expect(semver.satisfies('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
  expect(semver.satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
});

test('semver satisfies or', () => {
  expect(semver.satisfies('1.0.0', '1.0.0 || 2.0.0')).toBe(true);
  expect(semver.satisfies('2.0.0', '1.0.0 || 2.0.0')).toBe(true);
  expect(semver.satisfies('3.0.0', '1.0.0 || 2.0.0')).toBe(false);
});

test('semver satisfies star', () => {
  expect(semver.satisfies('1.0.0', '*')).toBe(true);
  expect(semver.satisfies('99.99.99', '*')).toBe(true);
});

test('semver maxSatisfying', () => {
  const versions = ['1.0.0', '1.1.0', '1.2.0', '2.0.0', '2.1.0'];
  expect(semver.maxSatisfying(versions, '^1.0.0')).toBe('1.2.0');
  expect(semver.maxSatisfying(versions, '^2.0.0')).toBe('2.1.0');
  expect(semver.maxSatisfying(versions, '*')).toBe('2.1.0');
});

test('semver compare with prerelease', () => {
  expect(semver.compare('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
  expect(semver.compare('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe(-1);
  expect(semver.compare('1.0.0', '1.0.0-rc.1')).toBe(1);
});

test('semver bare-major partial range (regression)', () => {
  expect(semver.satisfies('4.4.3', '4')).toBe(true);
  expect(semver.satisfies('4.0.0', '4')).toBe(true);
  expect(semver.satisfies('5.0.0', '4')).toBe(false);
  expect(semver.satisfies('1.0.0', '1')).toBe(true);
  expect(semver.satisfies('2.0.0', '1')).toBe(false);
});

test('semver bare-major.minor partial range', () => {
  expect(semver.satisfies('1.2.99', '1.2')).toBe(true);
  expect(semver.satisfies('1.3.0', '1.2')).toBe(false);
  expect(semver.satisfies('1.2.0', '1.2')).toBe(true);
});

test('semver space-separated multi-range (regression)', () => {
  expect(semver.satisfies('1.43.0', '>= 1.43.0 < 2')).toBe(true);
  expect(semver.satisfies('1.54.0', '>= 1.43.0 < 2')).toBe(true);
  expect(semver.satisfies('1.42.0', '>= 1.43.0 < 2')).toBe(false);
  expect(semver.satisfies('2.0.0', '>= 1.43.0 < 2')).toBe(false);
  expect(semver.satisfies('2.1.2', '>= 2.1.2 < 3.0.0')).toBe(true);
});

test('semver caret with prerelease (regression)', () => {
  expect(semver.satisfies('13.0.0-alpha.0', '^13.0.0-alpha.0')).toBe(true);
  expect(semver.satisfies('1.0.0-next.24', '^1.0.0-next.24')).toBe(true);
  expect(semver.satisfies('1.6.0-beta.0', '^1.6.0-beta.0')).toBe(true);
  expect(semver.satisfies('1.6.1', '^1.6.0-beta.0')).toBe(true);
});

test('semver hyphen range', () => {
  expect(semver.satisfies('1.5.0', '1.0.0 - 2.0.0')).toBe(true);
  expect(semver.satisfies('2.0.0', '1.0.0 - 2.0.0')).toBe(true);
  expect(semver.satisfies('2.0.1', '1.0.0 - 2.0.0')).toBe(false);
  expect(semver.satisfies('1.5.0', '1.0 - 2.0')).toBe(true);
  expect(semver.satisfies('2.1.0', '1.0 - 2.0')).toBe(false);
});

test('semver x-range', () => {
  expect(semver.satisfies('1.5.0', '1.x')).toBe(true);
  expect(semver.satisfies('2.0.0', '1.x')).toBe(false);
  expect(semver.satisfies('1.2.99', '1.2.x')).toBe(true);
  expect(semver.satisfies('1.3.0', '1.2.x')).toBe(false);
  expect(semver.satisfies('1.2.99', '*')).toBe(true);
});

test('semver prerelease gate', () => {
  expect(semver.satisfies('1.5.0-alpha.0', '^1.2.3')).toBe(false);
  expect(semver.satisfies('1.2.4-alpha', '^1.2.3-beta')).toBe(false);
  expect(semver.satisfies('1.2.4', '^1.2.3-beta')).toBe(true);
  expect(semver.satisfies('1.5.0-alpha.0', '^1.2.3', { includePrerelease: true })).toBe(true);
});
