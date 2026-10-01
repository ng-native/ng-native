/**
 * The test script names its test directories one by one, so a directory added later, or dropped
 * from the list in a merge, is never run, and nothing fails to say so: the migration's own tests
 * went unrun that way. This file is at the top level, where the script always finds it.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

it('runs the tests in every directory that has them', () => {
  const root = import.meta.dirname;
  const { scripts } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const listed = /\{([^}]*)\}\/\*\.test\.ts/.exec(scripts.test)?.[1]?.split(',') ?? [];
  const tested = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .filter((entry) => readdirSync(path.join(root, entry.name)).some((f) => f.endsWith('.test.ts')))
    .map((entry) => entry.name);
  for (const directory of tested) assert.ok(listed.includes(directory), directory);
});
