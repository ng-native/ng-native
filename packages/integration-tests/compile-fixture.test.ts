import assert from 'node:assert/strict';
import fs, {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { it, mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileFixture } from './compile.ts';

const directive = (selector: string) => `
  import { Directive } from '@angular/core';
  @Directive({ selector: '${selector}' }) export class Probe {}
`;

it('leaves a compiled copy in place while it says what its source compiles to, and replaces it when that changes', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compile-fixture-'));
  try {
    symlinkSync(
      fileURLToPath(new URL('./node_modules', import.meta.url)),
      path.join(root, 'node_modules'),
      // A junction on Windows, which needs no privileges; ignored elsewhere.
      'junction',
    );
    writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    const file = path.join(root, 'probe.ts');
    const generated = path.join(root, 'probe.generated.ts');
    writeFileSync(file, directive('probe'));
    await compileFixture(file);
    // A replaced file is a new one: what another process is importing must not be swapped out.
    const first = statSync(generated).ino;
    await compileFixture(file);
    assert.equal(statSync(generated).ino, first, 'the same source writes nothing');

    // Another process makes the copy between this one finding none and writing its own.
    let asked = false;
    const exists = fs.existsSync;
    const absent = mock.method(fs, 'existsSync', (file: fs.PathLike) => {
      if (file !== generated || asked) return exists(file);
      asked = true;
      return false;
    });
    syncBuiltinESMExports();
    try {
      await compileFixture(file);
    } finally {
      absent.mock.restore();
      syncBuiltinESMExports();
    }
    assert.equal(asked, true);
    assert.equal(statSync(generated).ino, first, 'a copy made meanwhile is not replaced');
    assert.deepEqual(
      readdirSync(root).filter((name) => name.endsWith('.tmp')),
      [],
    );

    writeFileSync(file, directive('changed'));
    await compileFixture(file);
    assert.match(readFileSync(generated, 'utf8'), /changed/, 'a changed source is compiled again');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('writes an import specifier with forward slashes, as a Windows checkout needs', async () => {
  const root = mkdtempSync(path.join(import.meta.dirname, '.compile-specifier-'));
  try {
    const sub = path.join(root, 'sub');
    mkdirSync(sub);
    const child = path.join(root, 'child.ts');
    const parent = path.join(sub, 'parent.ts');
    writeFileSync(child, directive('child'));
    writeFileSync(parent, `import '../child.ts';\n${directive('parent')}`);

    // `path.relative` separates with `\` on Windows. Make that the case on every platform, so
    // what a Windows checkout writes into the generated module is what this checks.
    const relative = path.relative;
    const windows = mock.method(path, 'relative', (from: string, to: string) =>
      relative(from, to).split(path.sep).join('\\'),
    );
    try {
      await compileFixture(parent);
    } finally {
      windows.mock.restore();
    }

    assert.match(
      readFileSync(path.join(sub, 'parent.generated.ts'), 'utf8'),
      /import '\.\.\/child\.generated\.ts'/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
