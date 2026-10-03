/**
 * Typechecks every ```ts code block in the docs against the real, installed packages - so an
 * import path that got renamed, an API that no longer exists, or a signature that changed shows
 * up here instead of in a reader's editor.
 *
 * Each block is written out as its own file under `.docs-samples/`, exactly as it appears in the
 * docs (no wrapping), then compiled together in one TypeScript program so resolution sees the
 * same `node_modules` a real app would.
 *
 * Many blocks are deliberately not full programs: a `@Component` shown without the imports a
 * paragraph above already established, a class member pasted without the class around it, or an
 * API-reference page listing a signature with no body. Those all fail to typecheck for reasons
 * that have nothing to do with the framework - a name the prose supplies, a parse error from a
 * fragment, a declaration with no implementation - so `isFragment` recognises that shape of
 * failure and sets the whole block aside as elided context rather than a bug. What is left after
 * that filter is diagnostics a real app would also hit: a wrong import path, a renamed export, a
 * bad argument type.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';
import { extractDocSamples, type DocSample } from './docs-samples.ts';

const OUT_DIR = path.join(import.meta.dirname, '.docs-samples');

/**
 * Diagnostic codes that are only ever a symptom of a fragment missing the name it needs, not of a
 * wrong or outdated docs sample. Their presence anywhere in a block is treated as proof the whole
 * block is context-dependent (see `isFragment` below), because once one name is unresolved,
 * TypeScript's error recovery for everything downstream of it - a property access, an inferred
 * generic, an implicit-any parameter - stops being a reliable signal either way.
 */
const MISSING_NAME_CODES = new Set([
  2304, // Cannot find name (a name the surrounding prose supplies)
  2552, // Cannot find name. Did you mean '...'?
  2593, // Cannot find name. Do you need to install type definitions for a test runner?
]);

/** Diagnostic codes a parsed-but-incomplete fragment throws off, on top of a missing name. */
const FRAGMENT_SYNTAX_CODES = new Set([
  1005, // ';' expected
  1109, // Expression expected
  1128, // Declaration or statement expected
  1136, // Property assignment expected
  1155, // 'const' declarations must be initialized
  1183, // An implementation cannot be declared in ambient contexts (signature-only listings)
  2391, // Function implementation is missing (a reference page listing a signature, not code)
  2683, // 'this' implicitly has type 'any' (a class member pasted without its class)
]);

/** A relative specifier ('./app.ts') is the docs pointing at app code the snippet never shows. */
function isMissingRelativeModule(diagnostic: ts.Diagnostic): boolean {
  if (diagnostic.code !== 2307) return false;
  const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  const specifier = /Cannot find module '([^']+)'/.exec(text)?.[1];
  return specifier !== undefined && (specifier.startsWith('.') || specifier.startsWith('/'));
}

/**
 * True once a block has shown any sign of assuming a name, an import or a class the fence itself
 * does not supply. When that is true the whole block is set aside as elided context rather than
 * checked diagnostic-by-diagnostic: everything downstream of an unresolved name is noise, DOM's
 * ambient globals (`screen`, `name`, ...) can quietly stand in for an unimported identifier of the
 * same name, and neither says anything about whether the docs are right.
 */
function isFragment(diagnostics: readonly ts.Diagnostic[]): boolean {
  return diagnostics.some(
    (d) =>
      MISSING_NAME_CODES.has(d.code) ||
      FRAGMENT_SYNTAX_CODES.has(d.code) ||
      isMissingRelativeModule(d),
  );
}

function fixtureName(sample: DocSample): string {
  return `${sample.file.replace(/[/.]/g, '-')}-L${sample.line}.generated.ts`;
}

function writeFixtures(samples: DocSample[]): Map<string, DocSample> {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const byPath = new Map<string, DocSample>();
  for (const sample of samples) {
    const file = path.join(OUT_DIR, fixtureName(sample));
    // Force module scope. A fence with no top-level `import` or `export` is otherwise a global
    // script to TypeScript, and its declarations would leak into every other fixture compiled
    // in the same program instead of staying scoped to the one doc block that wrote them.
    const isolated = /^\s*(import|export)\b/m.test(sample.code)
      ? sample.code
      : `${sample.code}\nexport {};\n`;
    writeFileSync(file, isolated);
    byPath.set(file, sample);
  }
  return byPath;
}

/**
 * A stylesheet imported for its side effect, as a bundler handles it: `import './styles.css'` is a
 * module with nothing in it.
 */
function writeStylesheetDeclaration(): string {
  const file = path.join(OUT_DIR, 'stylesheets.d.ts');
  // Reanimated is a peer an app installs, not a dependency here: a sample that animates with it
  // is checked for everything but what the library returns.
  writeFileSync(file, "declare module '*.css';\ndeclare module 'react-native-reanimated';\n");
  return file;
}

function typecheck(files: string[]): ts.Diagnostic[] {
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    types: ['node'],
    // No DOM, no browser: React Native's `screen`, `navigator` and so on are the package's own
    // exports, not the browser globals of the same name, and the DOM lib's ambient globals would
    // otherwise mask a fragment's missing import as a real type error on the wrong type.
    lib: ['lib.es2022.d.ts'],
  });
  return ts.getPreEmitDiagnostics(program).filter((d) => d.file !== undefined);
}

/** Every diagnostic, grouped by the fixture file it belongs to. */
function byFixture(diagnostics: ts.Diagnostic[]): Map<string, ts.Diagnostic[]> {
  const grouped = new Map<string, ts.Diagnostic[]>();
  for (const d of diagnostics) {
    const key = d.file!.fileName;
    grouped.set(key, [...(grouped.get(key) ?? []), d]);
  }
  return grouped;
}

/**
 * The Storybook page's samples compile against the Storybook this package installs, and the
 * release's Storybook check installs the version the page states, so all three are one version.
 */
it('installs the Storybook version the Storybook page states', () => {
  const page = readFileSync(
    path.join(
      import.meta.dirname,
      '../../apps/documentation/src/content/packages/web/storybook.md',
    ),
    'utf8',
  );
  const stated = /checked on Storybook (\d+\.\d+\.\d+) and Vite/.exec(page)?.[1];
  const manifest = JSON.parse(
    readFileSync(path.join(import.meta.dirname, 'package.json'), 'utf8'),
  ) as { devDependencies: Record<string, string> };
  assert.ok(stated, 'the Storybook page states no version');
  assert.deepEqual(
    [manifest.devDependencies['storybook'], manifest.devDependencies['@storybook/html-vite']],
    [stated, stated],
  );
});

describe('docs code samples typecheck against the real packages', () => {
  const samples = extractDocSamples();
  const structurallySkipped = samples.filter((s) => s.skipReason);
  const checkable = samples.filter((s) => !s.skipReason);

  it(`extracted ${samples.length} ts blocks from the docs`, () => {
    assert.ok(
      samples.length > 50,
      'expected to find ts code blocks under apps/documentation/src/content',
    );
  });

  for (const sample of structurallySkipped) {
    it(`skips ${sample.file}:${sample.line} - ${sample.skipReason}`, () => {
      assert.ok(sample.skipReason);
    });
  }

  it('typechecks every block that is not an obvious fragment', () => {
    const byPath = writeFixtures(checkable);
    const diagnostics = byFixture(typecheck([...byPath.keys(), writeStylesheetDeclaration()]));

    const elidedContext: DocSample[] = [];
    const failures: string[] = [];

    for (const [file, sample] of byPath) {
      const fileDiagnostics = diagnostics.get(file) ?? [];
      if (fileDiagnostics.length === 0) continue;

      if (isFragment(fileDiagnostics)) {
        elidedContext.push(sample);
        continue;
      }

      for (const d of fileDiagnostics) {
        const { line } = d.file!.getLineAndCharacterOfPosition(d.start!);
        const text = ts.flattenDiagnosticMessageText(d.messageText, '\n');
        failures.push(`${sample.file}:${sample.line + line} - ${text}`);
      }
    }

    // Recorded so a run's totals are visible without re-deriving them: how many of the
    // structurally checkable blocks turned out to depend on context the fence itself does not
    // show.
    if (elidedContext.length > 0) {
      console.log(
        `${elidedContext.length} block(s) assume context elided from the fence (an import ` +
          `shown earlier on the page, a class around a pasted member, a reference signature):\n` +
          elidedContext.map((s) => `  ${s.file}:${s.line}`).join('\n'),
      );
    }

    if (failures.length > 0) {
      assert.fail(`${failures.length} type error(s) in docs code samples:\n${failures.join('\n')}`);
    }
  });
});
