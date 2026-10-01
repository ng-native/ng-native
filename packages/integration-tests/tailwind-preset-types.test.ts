/**
 * The Tailwind 3 preset, imported from a `tailwind.config.ts` by the TypeScript compiler.
 *
 * Tailwind 3.3 and later load a TypeScript config, and one that imports `preset.cjs` needs the
 * declarations beside it, published with the package, or the import is an implicit `any` that a
 * strict project refuses.
 */
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';

/** This package, so the compiler resolves `@ng-native/tailwind` the way an app would. */
const HERE = import.meta.dirname;

/** What the compiler reports for a config file of this source, written with this extension. */
function diagnosticsFor(source: string, extension: 'ts' | 'cts'): string[] {
  const file = path.join(HERE, `.tailwind-config-${process.pid}.${extension}`);
  writeFileSync(file, source);
  try {
    const program = ts.createProgram([file], {
      strict: true,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
    });
    return ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  } finally {
    rmSync(file, { force: true });
  }
}

describe('the Tailwind 3 preset in a TypeScript config', () => {
  it('imports into an ES module config that satisfies Tailwind 3 Config', () => {
    const source = [
      `import nativePreset from '@ng-native/tailwind/preset.cjs';`,
      `import type { Config } from 'tailwindcss-v3';`,
      `export default { presets: [nativePreset], content: ['./src/**/*.ts'] } satisfies Config;`,
    ].join('\n');
    assert.deepEqual(diagnosticsFor(source, 'ts'), []);
  });

  it('imports into a CommonJS config', () => {
    const source = [
      `import nativePreset = require('@ng-native/tailwind/preset.cjs');`,
      `import type { Config } from 'tailwindcss-v3';`,
      `const config = { presets: [nativePreset], content: ['./src/**/*.ts'] } satisfies Config;`,
      `export = config;`,
    ].join('\n');
    assert.deepEqual(diagnosticsFor(source, 'cts'), []);
  });

  it('imports the web preset as it does the native one', () => {
    const source = [
      `import webPreset from '@ng-native/tailwind/web-preset.cjs';`,
      `import type { Config } from 'tailwindcss-v3';`,
      `export default { presets: [webPreset], content: ['./src/**/*.ts'] } satisfies Config;`,
    ].join('\n');
    assert.deepEqual(diagnosticsFor(source, 'ts'), []);
  });

  it('publishes the declarations with the presets', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(HERE, '../tailwind/package.json'), 'utf8'),
    ) as { files: string[] };
    for (const file of ['preset.d.cts', 'web-preset.d.cts', 'tailwind-3-preset.cjs']) {
      assert.ok(
        manifest.files.some((pattern) => path.matchesGlob(file, pattern)),
        `${file} in ${manifest.files.join(', ')}`,
      );
    }
  });
});
