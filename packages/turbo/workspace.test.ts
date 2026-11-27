import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { workspace } from './test-workspace.ts';

const require = createRequire(import.meta.url);
const { workspacePackages, scope } = require('./workspace.cjs');

describe('workspacePackages', () => {
  it('leaves out a package a negated glob excludes, and nothing else under its glob', () => {
    const files = workspace({
      'pnpm-workspace.yaml':
        'packages:\n  - "apps/*"\n  - "packages/*"\n  - "!packages/excluded"\n',
      'packages/excluded/package.json': JSON.stringify({ name: '@other/excluded' }),
    });
    assert.deepEqual(
      workspacePackages(files).map((pkg: { dir: string }) => pkg.dir),
      ['packages/ui'],
    );
    // An excluded package's scope does not count against the one the workspace's packages share.
    assert.equal(scope(files), '@repo');
  });
});
