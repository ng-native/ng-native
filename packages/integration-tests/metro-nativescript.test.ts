/**
 * An app with `@nativescript/react-native` installed gets the worklets plugin with `strictGlobal`,
 * so a worklet naming a native class looks it up on the UI runtime instead of capturing it on the
 * JavaScript thread, where it does not exist yet. An app with a Babel config of its own is told
 * what to add.
 *
 * A scratch project: Expo and Worklets linked from the canary, NativeScript a bare manifest, since
 * only its being installed is read.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const transformer = require('@ng-native/metro/transformer.cjs') as {
  transform(params: object): { ast?: unknown };
};
const generate = (require('@babel/generator') as { default: (ast: unknown) => { code: string } })
  .default;

const canary = path.resolve(import.meta.dirname, '../../examples/canary/node_modules');
const scratch = mkdtempSync(path.join(realpathSync(tmpdir()), 'metro-nativescript-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

function project(name: string): string {
  const root = path.join(scratch, name);
  mkdirSync(path.join(root, 'node_modules/@nativescript/react-native'), { recursive: true });
  writeFileSync(
    path.join(root, 'node_modules/@nativescript/react-native/package.json'),
    '{"name":"@nativescript/react-native","version":"9.1.0"}',
  );
  for (const linked of ['expo', 'react-native-worklets']) {
    symlinkSync(realpathSync(path.join(canary, linked)), path.join(root, 'node_modules', linked));
  }
  return root;
}

const WORKLET = `export const make = () => {\n  'worklet';\n  return UILabel.new();\n};\n`;

// The worklets plugin reads the file it is given, as well as the source.
const transform = (root: string) => (
  writeFileSync(path.join(root, 'label.js'), WORKLET),
  transformer.transform({
    filename: path.join(root, 'label.js'),
    src: WORKLET,
    options: { dev: true, platform: 'ios', projectRoot: root, enableBabelRCLookup: true },
    plugins: [],
  })
);

describe('NativeScript in the Babel config', () => {
  it('leaves a native class in a worklet to the UI runtime', () => {
    const code = generate(transform(project('installed')).ast).code;
    assert.match(code, /__workletHash/, 'the worklet is still a worklet');
    assert.doesNotMatch(code, /UILabel\s*[,}=:]/, 'UILabel is not captured into the closure');
  });

  it("warns once about an app's own config without strictGlobal", () => {
    const root = project('own-config');
    writeFileSync(path.join(root, 'babel.config.js'), 'module.exports = {};\n');
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message: string) => void warnings.push(String(message));
    try {
      for (let i = 0; i < 2; i++) {
        try {
          transform(root);
        } catch {
          // Its config is the app's to get right; only the warning is pinned here.
        }
      }
    } finally {
      console.warn = original;
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /strictGlobal/);
  });
});
