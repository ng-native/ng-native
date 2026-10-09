/**
 * AOT-compiles a source file through the exact same code path the Metro transformer uses, so
 * the tests exercise the real compiler rather than hand-written Ivy output.
 *
 * Relative imports that are themselves Angular sources are compiled too, so a fixture can
 * import the real host primitives instead of restating them.
 *
 * That is why the tests reach into `packages/*\/src/` by path rather than importing
 * `@ng-native/components` the way an app does: this walk needs the source file, and a
 * package barrel would pull decorated classes into Node, which cannot erase decorators.
 */
import { createRequire } from 'node:module';
import { existsSync, linkSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { transformAngular } = require('@ng-native/metro/angular-transform.cjs') as {
  transformAngular: (
    src: string,
    filename: string,
    options?: { dev?: boolean; platform?: 'web' },
  ) => { code: string; dependencies: string[] };
};

const HAS_ANGULAR_DECORATOR = /@(Component|Directive|Pipe|Injectable|NgModule)\s*\(/;
const RELATIVE_TS_IMPORT = /(from\s+|import\s+)(['"])(\.[^'"]*\.ts)\2/g;
const RESOURCE_IMPORT = /^import "\.\.?\/.*\.(html|css|scss)";$/gm;

export function compileToCode(file: string): { code: string; dependencies: string[] } {
  return transformAngular(readFileSync(file, 'utf8'), file);
}

/** Point relative imports of Angular sources at their compiled counterparts, compiling them. */
function rewriteImports(code: string, file: string, seen: Set<string>): string {
  code = code.replace(RESOURCE_IMPORT, '');
  return code.replace(RELATIVE_TS_IMPORT, (match, keyword, quote, specifier: string) => {
    const target = path.resolve(path.dirname(file), specifier);
    if (!existsSync(target) || !HAS_ANGULAR_DECORATOR.test(readFileSync(target, 'utf8'))) {
      return match;
    }
    const generated = emit(target, seen);
    return `${keyword}${quote}${path.relative(path.dirname(file), generated).replace(/^(?!\.)/, './')}${quote}`;
  });
}

/**
 * Write, then move into place, unless the file already says the same.
 *
 * Test files run in parallel processes and every one of them compiles the primitives its fixtures
 * import, so several write the same `.generated.ts` at once. A plain write lets another process
 * import the file halfway through it, and the failure is a `SyntaxError` about a missing export
 * from a file that plainly has it. The content is a pure function of the source, so either
 * version is correct - what has to be atomic is only the swap.
 *
 * A copy that is already right is left alone, and a first copy is linked into place, which fails
 * where another process has just made one instead of replacing it. Some filesystems show a
 * missing file for a moment while one is replaced, and a process importing it then fails. So a
 * file is replaced only when its source changed since the last run.
 */
function writeAtomically(out: string, code: string): void {
  const upToDate = () => existsSync(out) && readFileSync(out, 'utf8') === code;
  if (upToDate()) return;
  const temporary = `${out}.${process.pid}.tmp`;
  writeFileSync(temporary, code);
  try {
    linkSync(temporary, out);
  } catch {
    // It is there already (or this filesystem has no links): replace it unless it says the same.
    if (!upToDate()) return renameSync(temporary, out);
  }
  rmSync(temporary);
}

function emit(file: string, seen: Set<string>): string {
  const out = file.replace(/\.ts$/, '.generated.ts');
  if (seen.has(file)) return out;
  seen.add(file);

  const { code } = transformAngular(readFileSync(file, 'utf8'), file);
  // Node's own type stripping stands in for what @react-native/babel-preset does in Metro.
  writeAtomically(out, rewriteImports(code, file, seen));
  return out;
}

/** A path given relative to this directory, as `fixtures/button.ts`. An absolute one is kept. */
const fromHere = (file: string): string => path.resolve(import.meta.dirname, file);

export async function compileFixture(file: string): Promise<Record<string, unknown>> {
  return import(pathToFileURL(emit(fromHere(file), new Set())).href);
}

/**
 * The same fixture compiled as Metro compiles it for the browser, where a component's `styles`
 * stay CSS rather than becoming the native rule set. Only the fixture itself: the primitives it
 * imports carry no styles, so they are the native copies `compileFixture` writes, and a test that
 * renders both ways renders the same component classes.
 */
export async function compileFixtureForWeb(relative: string): Promise<Record<string, unknown>> {
  const file = fromHere(relative);
  const out = file.replace(/\.ts$/, '.web.generated.ts');
  const { code } = transformAngular(readFileSync(file, 'utf8'), file, { platform: 'web' });
  writeAtomically(out, rewriteImports(code, file, new Set()));
  return import(pathToFileURL(out).href);
}

/**
 * Compile source text as if it were `file`, writing the result to `out` and importing it. For
 * tests that edit a fixture in memory, as HMR does across a save.
 */
export async function compileSource(
  source: string,
  file: string,
  out: string,
  options: { dev?: boolean } = {},
): Promise<Record<string, unknown>> {
  const { code } = transformAngular(source, file, options);
  writeAtomically(out, rewriteImports(code, file, new Set()));
  return import(pathToFileURL(out).href);
}
