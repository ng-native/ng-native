/**
 * `@ng-native/template` comes set up for tests inside the running app on iOS and Android, as the
 * desktop template is on macOS: `npx vitest --project ios` works in a new app with nothing to add.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const template = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../template/${file}`, import.meta.url)), 'utf8');

describe("the template's in-app tests", () => {
  it("wraps Metro's config for them, and starts the test host for them in main.ts", () => {
    // Without withDeviceTests a dev bundle follows main.ts's dead branch into the test host, and
    // Vitest behind it.
    assert.match(template('metro.config.js'), /withDeviceTests\(withAngularNative\(/);
    const main = template('src/main.ts');
    assert.match(main, /if \(process\.env\.EXPO_PUBLIC_DEVICE_TESTS\) \{/);
    assert.match(
      main,
      /startDeviceTests\(\{\s*mount: mountOptions,\s*\/\/[^\n]*\n\s*onMount: \(app\) => \{\s*const stopWatching = watchConditions\(app\.engine\);\s*app\.applicationRef\.onDestroy\(stopWatching\);/,
    );
    // The app mounts with the same options its tests do.
    assert.match(main, /mount\(Number\(rootTag\), App, getFabricUIManager\(\), mountOptions\(\)\)/);
  });

  it('has a Node project and one for iOS and Android each, and npm test runs Node alone', () => {
    const config = template('vitest.config.mts');
    assert.match(config, /ngNative\(\)\], test: \{ name: 'node' \}/);
    assert.match(config, /deviceTests\(\{ platform: 'ios' \}\)/);
    assert.match(config, /deviceTests\(\{ platform: 'android' \}\)/);
    const { scripts } = JSON.parse(template('package.json')) as { scripts: Record<string, string> };
    assert.equal(scripts['test'], 'vitest run --project node');
  });

  it('has an in-app test beside the Node one, and says how to run it', () => {
    assert.match(template('src/app/app.device.ts'), /Platform\.OS/);
    for (const file of ['README.md', 'AGENTS.md']) {
      assert.match(template(file), /npx vitest --project ios/, file);
      assert.match(template(file), /npx vitest --project android/, file);
    }
  });

  it('ignores the capture and difference a failed screenshot comparison writes', () => {
    const ignored = template('gitignore').split('\n');
    assert.ok(ignored.includes('**/__screenshots__/**/*-actual.png'));
    assert.ok(ignored.includes('**/__screenshots__/**/*-diff.png'));
    // The references themselves are committed.
    assert.ok(!ignored.some((line) => /__screenshots__\/?$/.test(line)));
  });
});
