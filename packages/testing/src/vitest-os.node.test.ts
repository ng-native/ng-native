/**
 * The Vitest preset's `os`: which platform file an extensionless import resolves, as Metro and
 * Expo SDK 58 do (`.macos`, then `.ios`, then `.native` on a Mac), and the OS the tests render as.
 * Unset, it follows `expo.platforms` in the app's `app.json`.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { PLATFORM_EXTENSIONS, defaultOs, extensionsFor, ngNative } from '../runner/vitest.mjs';

/** The engine as the setup file resolves it, so a test in a temp folder reads the same instance. */
const FABRIC = realpathSync(createRequire(import.meta.url).resolve('@ng-native/fabric'));

describe('the platform extensions', () => {
  it('are the chain Expo SDK 58 resolves for each OS', () => {
    assert.deepEqual(PLATFORM_EXTENSIONS, {
      ios: ['ios', 'native'],
      android: ['android', 'native'],
      macos: ['macos', 'ios', 'native'],
      web: ['web'],
    });
  });

  it('put each platform extension ahead of the plain ones', () => {
    const macos = extensionsFor('macos');
    assert.ok(macos.indexOf('.macos.ts') < macos.indexOf('.ios.ts'));
    assert.ok(macos.indexOf('.ios.ts') < macos.indexOf('.native.ts'));
    assert.ok(macos.indexOf('.native.ts') < macos.indexOf('.ts'));
    assert.ok(!extensionsFor('android').includes('.ios.ts'));
  });
});

describe('the default OS', () => {
  let root: string;
  before(() => (root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ngn-os-')))));
  after(() => rmSync(root, { recursive: true, force: true }));

  const withPlatforms = (platforms: unknown) => {
    writeFileSync(path.join(root, 'app.json'), JSON.stringify({ expo: { platforms } }));
    return defaultOs(root);
  };

  it('follows expo.platforms', () => {
    assert.equal(withPlatforms(['macos']), 'macos');
    assert.equal(withPlatforms(['android']), 'android');
    assert.equal(withPlatforms(['ios', 'android', 'macos']), 'ios');
    assert.equal(withPlatforms(undefined), 'ios');
  });

  it('is iOS with no app.json', () => {
    rmSync(path.join(root, 'app.json'), { force: true });
    assert.equal(defaultOs(root), 'ios');
  });
});

describe('a Vitest run with an os', () => {
  let root: string;
  before(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ngn-vitest-os-')));
    writeFileSync(path.join(root, 'storage.ts'), "export const from = 'plain';\n");
    writeFileSync(path.join(root, 'storage.native.ts'), "export const from = 'native';\n");
    writeFileSync(path.join(root, 'storage.ios.ts'), "export const from = 'ios';\n");
    writeFileSync(path.join(root, 'storage.macos.ts'), "export const from = 'macos';\n");
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  /** Runs a test that passes when `./storage` is `expected` and the engine renders as `os`. */
  async function run(expected: string, platform: string, options?: Parameters<typeof ngNative>[0]) {
    writeFileSync(
      path.join(root, 'os.test.ts'),
      "import { expect, it } from 'vitest';\n" +
        `import { nativePlatform } from '${FABRIC}';\n` +
        "import { from } from './storage';\n" +
        `it('resolves', () => expect([from, nativePlatform()]).toEqual(['${expected}', '${platform}']));\n`,
    );
    const { createVitest } = await import('vitest/node');
    const vitest = await createVitest(
      'test',
      { root, config: false, watch: false, reporters: [], include: ['os.test.ts'] },
      { plugins: [ngNative(options)] },
    );
    try {
      await vitest.start();
      return vitest.state.getCountOfFailedTests();
    } finally {
      await vitest.close();
    }
  }

  it('resolves the .macos file, and renders as macOS, on a Mac', async () => {
    assert.equal(await run('macos', 'macos', { os: 'macos' }), 0);
  });

  it('resolves the .ios file on a Mac when there is no .macos one', async () => {
    rmSync(path.join(root, 'storage.macos.ts'));
    try {
      assert.equal(await run('ios', 'macos', { os: 'macos' }), 0);
    } finally {
      writeFileSync(path.join(root, 'storage.macos.ts'), "export const from = 'macos';\n");
    }
  });

  it('resolves the .native file on Android', async () => {
    assert.equal(await run('native', 'android', { os: 'android' }), 0);
  });

  it("takes the OS from the app's expo.platforms when the options name none", async () => {
    writeFileSync(path.join(root, 'app.json'), JSON.stringify({ expo: { platforms: ['macos'] } }));
    try {
      assert.equal(await run('macos', 'macos'), 0);
    } finally {
      rmSync(path.join(root, 'app.json'), { force: true });
    }
  });

  it('resolves the .ios file by default', async () => {
    assert.equal(await run('ios', 'ios'), 0);
  });
});
