/**
 * Release gate: a production bundle must be Hermes bytecode with no Angular JIT compiler in it.
 * Release builds are AOT-only (see docs/ARCHITECTURE.md), and Hermes excludes local-mode eval, so a compiler in the
 * bundle is both dead weight and a sign that something fell back to JIT.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const APP = path.resolve(import.meta.dirname, '..');
const PLATFORM = process.argv[2] ?? 'ios';

// Identifiers that exist only in @angular/compiler. Plain "@angular/compiler" is no good as a
// probe: it appears as error-message text inside @angular/core.
const COMPILER_ONLY = [
  'R3TargetBinder',
  'HtmlParser',
  'makeBindingParser',
  '_ParseAST',
  'TemplateBinder',
  'JitEvaluator',
];

const out = mkdtempSync(path.join(tmpdir(), 'angular-native-bundle-'));
let failures = 0;
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!ok) failures++;
};

try {
  // --clear because Metro keys its cache on the transformer, and a release check that reuses
  // whatever the dev server left behind is not checking the release build.
  execFileSync('npx', ['expo', 'export', '--clear', '--platform', PLATFORM, '--output-dir', out], {
    cwd: APP,
    stdio: 'inherit',
  });

  const dir = path.join(out, '_expo/static/js', PLATFORM);
  const bundle = readdirSync(dir).find((file) => file.endsWith('.hbc') || file.endsWith('.js'));
  check(Boolean(bundle), `a ${PLATFORM} bundle was produced`);

  const file = path.join(dir, bundle);
  const bytes = readFileSync(file);
  check(bundle.endsWith('.hbc'), 'bundle is Hermes bytecode, not plain JS');

  const text = bytes.toString('latin1');
  for (const symbol of COMPILER_ONLY) {
    check(!text.includes(symbol), `no ${symbol} (compiler-only symbol) in the bundle`);
  }

  // The HMR blocks are emitted only when Metro says dev. If one reaches a release build it
  // ships a second copy of every template and a globalThis registry that never gets used.
  for (const symbol of ['__angularNativeHmr', '_ApplyMetadata', '__angularNativeReload']) {
    check(!text.includes(symbol), `no ${symbol} (dev-only HMR wiring) in the bundle`);
  }

  // Angular compiles a component's CSS into `styles: [...]` and again into the class metadata.
  // Nothing here reads either: the host that would apply them lives in platform-browser. Both are
  // stripped for release, and these notice if that stops happening, because the only symptom
  // otherwise is a bundle that is quietly bigger.
  //
  // The shim attribute is only ever written into Angular-emitted component styles, so its
  // presence means a stylesheet shipped. A raw template string only survives via class metadata,
  // since AOT turns templates into instructions.
  check(!text.includes('_ngcontent-%COMP%'), 'no shimmed component CSS in the bundle');
  // A `:host`-only sheet shims to this one alone, which is the shape a library's often takes, and
  // a library's reaches the bundle through the linker rather than the compiler.
  check(!text.includes('_nghost-%COMP%'), 'no shimmed host CSS, from a library or the app');
  check(
    !text.includes('<native-stack-outlet />'),
    'no class metadata (raw templates) in the bundle',
  );
  // And the styling that is actually used did survive: this colour exists only in a compiled
  // sheet, converted from the hex the canary's CSS is written with.
  check(text.includes('rgb(127, 209, 138)'), 'the compiled stylesheets did ship');

  console.log(`\n${(bytes.length / 1024 / 1024).toFixed(1)}MB  ${bundle}`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

process.exit(failures ? 1 : 0);
