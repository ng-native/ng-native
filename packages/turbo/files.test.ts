import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import { workspace } from './test-workspace.ts';

const require = createRequire(import.meta.url);
const { findRoot } = require('./files.cjs');

describe('findRoot', () => {
  it("finds a root turbo.jsonc, past an app's own turbo.json that extends it", () => {
    const files = workspace({
      'package.json': JSON.stringify({ name: 'my-turborepo' }),
      'pnpm-workspace.yaml': null,
      'turbo.jsonc': '{\n  // tasks\n  "tasks": {}\n}\n',
      'apps/mobile/turbo.json': JSON.stringify({ extends: ['//'] }),
    });
    const src = path.join(files.root, 'apps/mobile/src');
    mkdirSync(src);
    assert.equal(findRoot(src), files.root);
  });
});
