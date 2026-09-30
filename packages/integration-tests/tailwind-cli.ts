/**
 * The real Tailwind CLI, for tests that need its output rather than a checked-in fixture of it.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StyleResolver, type StyleSheet, type StyleTarget } from '@ng-native/fabric';
import type { FakeFabric, FakeFabricNode } from '@ng-native/testing';

/**
 * Tailwind 4's CLI, by path. `npx` would run whichever `tailwindcss` binary is linked into
 * `node_modules/.bin`, and Tailwind 3, installed here for its own tests, links one too.
 */
const CLI = join(
  dirname(createRequire(import.meta.url).resolve('@tailwindcss/cli/package.json')),
  'dist/index.mjs',
);

/** This package, so the CLI resolves `@ng-native/tailwind` the way an app would. */
const HERE = fileURLToPath(new URL('.', import.meta.url));

/**
 * Builds one preset with the real CLI and hands back its output, with `app` as the app's own CSS
 * after the preset and `prefix` on Tailwind's imports.
 *
 * Run from this package, which has the workspace dependency installed - the CLI resolves imports
 * from the entry file's own directory, so a temp directory somewhere else cannot see
 * `@ng-native/tailwind` at all.
 */
export function build(preset: 'native' | 'web', classes: string, app = '', prefix = ''): string {
  const prefixed = prefix ? ` prefix(${prefix})` : '';
  const dir = HERE;
  const entry = join(dir, `.preset-test-${preset}-${process.pid}.css`);
  const outDir = mkdtempSync(join(tmpdir(), 'preset-'));
  const out = join(outDir, 'out.css');
  writeFileSync(
    entry,
    [
      `@import 'tailwindcss/theme.css'${prefixed};`,
      // Only the classes asked for: scanning this package would pick up every class named in
      // any test or fixture here, and make each test's sheet depend on all the others.
      `@import 'tailwindcss/utilities.css' source(none)${prefixed};`,
      `@import '@ng-native/tailwind/${preset}.css';`,
      `@source inline("${classes}");`,
      app,
    ].join('\n'),
  );
  try {
    execFileSync(process.execPath, [CLI, '-i', entry, '-o', out], { cwd: dir, stdio: 'pipe' });
    return readFileSync(out, 'utf8');
  } finally {
    rmSync(entry, { force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** Tailwind 3's CLI output for exactly these classes, through the preset as the setup guide says. */
export function buildV3(classes: string, app: object = {}, css = ''): string {
  const dir = mkdtempSync(join(tmpdir(), 'tailwind-v3-'));
  const preset = createRequire(import.meta.url).resolve('@ng-native/tailwind/preset.cjs');
  const config = { ...app, content: [{ raw: classes }] };
  writeFileSync(
    join(dir, 'tailwind.config.js'),
    `module.exports = { presets: [require(${JSON.stringify(preset)})], ...${JSON.stringify(config)} };`,
  );
  writeFileSync(
    join(dir, 'in.css'),
    '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' + css,
  );
  try {
    execFileSync(
      process.execPath,
      [
        createRequire(import.meta.url).resolve('tailwindcss-v3/lib/cli.js'),
        '-c',
        'tailwind.config.js',
        '-i',
        'in.css',
        '-o',
        'out.css',
      ],
      { cwd: dir, stdio: 'pipe' },
    );
    return readFileSync(join(dir, 'out.css'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The props a node was last committed with. */
export function committedProps(fabric: FakeFabric, node: unknown): Record<string, unknown> {
  const all = (n: FakeFabricNode): FakeFabricNode[] => [n, ...n.children.flatMap(all)];
  const found = fabric.committed.flatMap(all).find((n) => n.instanceHandle === node);
  assert.ok(found, 'committed');
  return found.props;
}

/**
 * What an element wearing `classes` resolves to under a root, with the sheet as the global one: a
 * theme token is resolved where it is read, so this, not a rule's own declarations, is what a
 * utility comes to.
 */
export function resolvedClasses(sheet: StyleSheet, classes: string): Record<string, unknown> {
  const target = (parent: StyleTarget | null, own: string): StyleTarget => ({
    name: 'view',
    parent,
    classes: new Set(own.split(/\s+/).filter(Boolean)),
    props: {},
    sheet: null,
    hostSheet: null,
    styleCache: null,
    styleDirty: true,
  });
  const node = target(target(null, ''), classes);
  const resolver = new StyleResolver(sheet, { width: 400, height: 800, colorScheme: 'light' });
  return resolver.resolve(node, 1).style;
}
