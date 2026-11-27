/**
 * A workspace on disk for the generators' tests, as `create-turbo` 2.11 lays one out: an unscoped
 * root, `my-turborepo`, on pnpm 11 with TypeScript 7, `apps/*` and `packages/*`, and a React
 * library already at `packages/ui`, named `@repo/ui`. Each test's files replace these, and `null`
 * leaves one out. It is removed after the test that made it.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'node:test';

const require = createRequire(import.meta.url);
const { workspaceFiles } = require('./files.cjs');

export type Files = ReturnType<typeof workspaceFiles>;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

export function workspace(files: Record<string, string | null> = {}): Files {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'ng-native-turbo-'));
  roots.push(root);
  const all = {
    'package.json': JSON.stringify({
      name: 'my-turborepo',
      private: true,
      devDependencies: { prettier: '3.9.6', turbo: '^2.11.13', typescript: '7.0.2' },
      packageManager: 'pnpm@11.25.0',
    }),
    'pnpm-workspace.yaml': 'packages:\n  - "apps/*"\n  - "packages/*"\n',
    'packages/ui/package.json': JSON.stringify({
      name: '@repo/ui',
      private: true,
      exports: { './*': './src/*.tsx' },
      dependencies: { react: '19.2.8', 'react-dom': '19.2.8' },
    }),
    '.gitignore': 'node_modules\n',
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
    if (content === null) continue;
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return workspaceFiles(root);
}
