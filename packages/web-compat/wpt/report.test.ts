import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, expectationOf, verdict } from './report.mjs';

/** A file's result as the worker reports it: `passed` of `names` passed. */
const result = (status: string, names: string[], passed: string[]) => ({
  status,
  subtests: names.map((name) => ({ name, status: passed.includes(name) ? 'PASS' : 'FAIL' })),
});

const recorded = {
  'a.html': expectationOf(result('OK', ['one', 'two', 'three'], ['one', 'two'])),
  'b.html': expectationOf(result('TIMEOUT', ['one'], [])),
};

const kinds = (results: Record<string, unknown>, whole = true) =>
  compare(recorded, results, () => whole).map((each: { path: string; kind: string }) =>
    [each.path, each.kind].join(' '),
  );

test('a run that is what was recorded has no changes, and passes --check', () => {
  const results = {
    'a.html': result('OK', ['one', 'two', 'three'], ['one', 'two']),
    'b.html': result('TIMEOUT', ['one'], []),
  };
  assert.deepEqual(kinds(results), []);
  assert.deepEqual(verdict(compare(recorded, results, () => true)), { worse: 0, unrecorded: 0 });
});

test('a file passing fewer subtests, or other ones, is worse', () => {
  const fewer = { 'a.html': result('OK', ['one', 'two', 'three'], ['one']) };
  const others = { 'a.html': result('OK', ['one', 'two', 'three'], ['one', 'three']) };
  assert.deepEqual(kinds(fewer, false), ['a.html failing']);
  assert.deepEqual(kinds(others, false), ['a.html failing']);
  assert.deepEqual(verdict(compare(recorded, fewer, () => false)), { worse: 1, unrecorded: 0 });
});

test('a file that ends another way, passing the same subtests, is no change', () => {
  // A file passing nothing lands either side of its time limit from one run to the next.
  const results = {
    'a.html': result('TIMEOUT', ['one', 'two', 'three'], ['one', 'two']),
    'b.html': result('OK', ['one'], []),
  };
  assert.deepEqual(kinds(results, false), []);
});

test('a file passing more is not recorded, and fails --check as a regression does', () => {
  const results = { 'a.html': result('OK', ['one', 'two', 'three'], ['one', 'two', 'three']) };
  assert.deepEqual(kinds(results, false), ['a.html passing']);
  assert.deepEqual(verdict(compare(recorded, results, () => false)), { worse: 0, unrecorded: 1 });
});

test('a file with more or fewer subtests, passing as many, is not recorded either', () => {
  const results = {
    'a.html': result('OK', ['one', 'two', 'three', 'four'], ['one', 'two']),
    'b.html': result('TIMEOUT', [], []),
  };
  assert.deepEqual(kinds(results, false), ['a.html changed', 'b.html changed']);
  assert.deepEqual(verdict(compare(recorded, results, () => false)), { worse: 0, unrecorded: 2 });
});

test('a file the expectations do not have is not recorded', () => {
  const results = { 'c.html': result('OK', ['one'], ['one']) };
  assert.deepEqual(kinds(results, false), ['c.html new']);
  assert.deepEqual(verdict(compare(recorded, results, () => false)), { worse: 0, unrecorded: 1 });
});

test('a recorded file not run is worse where it was asked for, and no news where it was not', () => {
  const results = { 'a.html': result('OK', ['one', 'two', 'three'], ['one', 'two']) };
  assert.deepEqual(kinds(results, true), ['b.html missing']);
  assert.deepEqual(verdict(compare(recorded, results, () => true)), { worse: 1, unrecorded: 0 });
  assert.deepEqual(kinds(results, false), []);
  const onlyB = compare(recorded, results, (path: string) => path.startsWith('b'));
  assert.deepEqual(verdict(onlyB), { worse: 1, unrecorded: 0 });
});
