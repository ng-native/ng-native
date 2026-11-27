import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { workspace } from '../test-workspace.ts';

const require = createRequire(import.meta.url);
const { component, names } = require('./index.cjs');
const { componentSource, testSource } = require('./sources.cjs');

/** A workspace with an app and a library generated into it, as the generators write them. */
function withPackages() {
  return workspace({
    'apps/mobile/package.json': JSON.stringify({
      name: '@acme/mobile',
      dependencies: { '@ng-native/platform': '0.25.0', '@ng-native/components': '0.25.0' },
    }),
    'apps/mobile/app.json': '{}',
    'packages/ui/package.json': JSON.stringify({
      name: '@acme/ui',
      peerDependencies: { '@ng-native/components': '0.25.0' },
    }),
    'packages/ui/src/index.ts': "export { Ui } from './lib/ui.ts';\n",
    'packages/config/package.json': JSON.stringify({ name: '@acme/config' }),
  });
}

describe('ng-native-component', () => {
  it("writes a native component and its test in a folder of its own under an app's src/app", async () => {
    const files = withPackages();
    await component(files, { name: 'profile-card', package: '@acme/mobile' });
    const folder = 'apps/mobile/src/app/profile-card';
    assert.equal(
      files.read(`${folder}/profile-card.ts`),
      componentSource('ProfileCard', 'profile-card', 'profile-card works'),
    );
    assert.equal(
      files.read(`${folder}/profile-card.test.ts`),
      testSource('ProfileCard', 'profile-card', 'profile-card works'),
    );
  });

  it("puts a library's under src/lib, prefixed by its scope, and exports it from its index", async () => {
    const files = withPackages();
    await component(files, { name: 'avatar', package: 'packages/ui' });
    assert.match(files.read('packages/ui/src/lib/avatar/avatar.ts')!, /selector: 'acme-avatar'/);
    assert.equal(
      files.read('packages/ui/src/index.ts'),
      "export { Ui } from './lib/ui.ts';\nexport { Avatar } from './lib/avatar/avatar.ts';\n",
    );
  });

  it('writes flat, into a subfolder the name gives, and without a test when asked', async () => {
    const files = withPackages();
    await component(files, {
      name: 'cards/user-card',
      package: '@acme/ui',
      flat: true,
      skipTests: true,
    });
    assert.ok(files.exists('packages/ui/src/lib/cards/user-card.ts'));
    assert.equal(files.exists('packages/ui/src/lib/cards/user-card.test.ts'), false);
    assert.match(files.read('packages/ui/src/index.ts')!, /from '\.\/lib\/cards\/user-card\.ts'/);
  });

  it('names the file in kebab case and the class in Pascal case, without a suffix', () => {
    assert.deepEqual(names('profileCard'), { fileName: 'profile-card', className: 'ProfileCard' });
    assert.deepEqual(names('Profile card'), { fileName: 'profile-card', className: 'ProfileCard' });
    assert.throws(() => names('1st'), /start it with a letter/);
  });

  it('refuses a package that is not an Angular Native app or library, naming those there are', async () => {
    const files = withPackages();
    await assert.rejects(
      component(files, { name: 'card', package: '@acme/config' }),
      /no Angular Native app or library called "@acme\/config"\. Those it has: @acme\/mobile, @acme\/ui/,
    );
  });

  it('leaves a component that exists alone', async () => {
    const files = withPackages();
    await component(files, { name: 'card', package: '@acme/mobile' });
    await assert.rejects(
      component(files, { name: 'card', package: '@acme/mobile' }),
      /already exists/,
    );
  });

  it('refuses a name whose class would shadow an import, or a path out of the package', async () => {
    const files = withPackages();
    for (const name of ['view', 'Text', 'component']) {
      await assert.rejects(
        component(files, { name, package: '@acme/ui' }),
        /is a name the component imports/,
      );
    }
    await assert.rejects(
      component(files, { name: '../../outside/card', package: '@acme/ui' }),
      /has to stay inside the package/,
    );
    assert.equal(files.exists('packages/outside'), false);
  });

  it('refuses a name the library already exports, and writes nothing', async () => {
    const files = withPackages();
    await assert.rejects(
      component(files, { name: 'ui', package: '@acme/ui', flat: true }),
      /already exports Ui/,
    );
    assert.equal(files.exists('packages/ui/src/lib/ui.ts'), false);
    assert.equal(files.read('packages/ui/src/index.ts'), "export { Ui } from './lib/ui.ts';\n");
  });
});
