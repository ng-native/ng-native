/**
 * The migrations in `@ng-native/migrate`, as `nx migrate`, `ng update` and `ng-native-migrate` run
 * them: registered the same way for each tool, and changing the same files the same way.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { acrossAdapters, viaCli, viaNx } from './migrations.ts';

const require = createRequire(import.meta.url);
const { migrations } = require('@ng-native/migrate') as {
  migrations: { name: string; version: string; description: string; run: () => string[] }[];
};
const { main } = require('@ng-native/migrate/cli.cjs') as { main: (argv: string[]) => number };
const own = require('@ng-native/migrate/package.json') as { version: string };
const json = (file: string) => JSON.parse(readFileSync(require.resolve(file), 'utf8'));
const cli = require.resolve('@ng-native/migrate/cli.cjs');

describe('the migrations nx migrate and ng update run', () => {
  const registered = migrations.map(({ name, version, description }) => ({
    name,
    version,
    description,
  }));

  it('lists every migration in @ng-native/nx, as it is registered in @ng-native/migrate', () => {
    const { generators } = json('@ng-native/nx/migrations.json');
    assert.deepEqual(
      Object.entries(generators).map(([name, entry]: [string, any]) => ({
        name,
        version: entry.version,
        description: entry.description,
      })),
      registered,
    );
    for (const [name, entry] of Object.entries(generators) as [string, any][]) {
      assert.equal(entry.implementation, `./migrations/run.cjs#${name}`);
    }
  });

  it('lists every migration in @ng-native/schematics, as it is registered in @ng-native/migrate', () => {
    const { schematics } = json('@ng-native/schematics/migrations.json');
    assert.deepEqual(
      Object.entries(schematics).map(([name, entry]: [string, any]) => ({
        name,
        version: entry.version,
        description: entry.description,
      })),
      registered,
    );
    for (const [name, entry] of Object.entries(schematics) as [string, any][]) {
      assert.equal(entry.factory, `./migrations/run.cjs#${name}`);
    }
  });
});

describe('sync-app-versions, through nx migrate, ng update and ng-native-migrate', () => {
  const files = {
    'package.json': JSON.stringify({
      name: 'shop',
      dependencies: { '@ng-native/components': '^0.1.3', expo: '~57.0.26' },
    }),
    'apps/mobile/package.json': JSON.stringify({
      name: 'mobile',
      dependencies: { '@ng-native/platform': '0.1.3', '@ng-native/fabric': 'workspace:*' },
      peerDependencies: { '@ng-native/router': '>=0.1.0' },
    }),
    // Installed packages, and anything hidden, are not the app's to change.
    'node_modules/@ng-native/web/package.json': '{"dependencies":{"@ng-native/fabric":"0.1.3"}}',
    '.cache/package.json': '{"dependencies":{"@ng-native/fabric":"0.1.3"}}',
    // A generator's template is named package.json too, and is not JSON until it is filled in.
    'tools/app/files/package.json': '{ "name": "<%= name %>", "dependencies": { <%= deps %> } }',
    'pnpm-lock.yaml': '',
  };

  it('moves the same versions the same way, and says to install', async () => {
    const { nx, angular, cli } = await acrossAdapters(files, 'sync-app-versions', '0.1.3');
    const app = JSON.parse(nx.files['apps/mobile/package.json']!);
    assert.deepEqual(app.dependencies, {
      '@ng-native/platform': own.version,
      '@ng-native/fabric': 'workspace:*',
    });
    assert.deepEqual(app.peerDependencies, { '@ng-native/router': '>=0.1.0' });
    assert.equal(
      JSON.parse(nx.files['package.json']!).dependencies['@ng-native/components'],
      `^${own.version}`,
    );
    assert.equal(
      nx.files['node_modules/@ng-native/web/package.json'],
      files['node_modules/@ng-native/web/package.json'],
    );
    assert.equal(nx.files['.cache/package.json'], files['.cache/package.json']);
    assert.equal(nx.files['tools/app/files/package.json'], files['tools/app/files/package.json']);
    assert.deepEqual(nx.notes, [
      'Run pnpm install to install the @ng-native versions the projects now list.',
    ]);
    assert.deepEqual(angular, nx);
    assert.deepEqual(cli, nx);
  });

  it("keeps each package.json's own indentation and final newline", async () => {
    const tabs = '{\n\t"dependencies": {\n\t\t"@ng-native/components": "^0.1.3"\n\t}\n}\n';
    const four = '{\n    "dependencies": {\n        "@ng-native/fabric": "0.1.3"\n    }\n}';
    const { nx, angular, cli } = await acrossAdapters(
      { 'tabs/package.json': tabs, 'four/package.json': four },
      'sync-app-versions',
      '0.1.3',
    );
    assert.equal(nx.files['tabs/package.json'], tabs.replace('0.1.3', own.version));
    assert.equal(nx.files['four/package.json'], four.replace('0.1.3', own.version));
    assert.deepEqual(angular, nx);
    assert.deepEqual(cli, nx);
  });

  it('changes nothing the second time', async () => {
    const first = await viaNx(files, 'sync-app-versions');
    const again = await viaNx(first.files as Record<string, string>, 'sync-app-versions');
    assert.deepEqual(again, { files: first.files, notes: [] });
  });
});

describe('split-store-and-player, through nx migrate, ng update and ng-native-migrate', () => {
  const files = {
    'src/app/settings.ts': [
      '// Settings, kept on the device.',
      "import { Injectable, inject } from '@angular/core';",
      "import { SecureStorage, Storage as Prefs, type NativeStore, Store } from '@ng-native/expo/store';",
      "import { StoreReview } from '@ng-native/expo/store-review';",
      "import type { Player } from '@ng-native/expo/player';",
      'import { audioPlayer, videoPlayer } from "@ng-native/expo/player"',
      '',
      "export { Storage } from '@ng-native/expo/store';",
      '',
    ].join('\n'),
    'src/app/all.ts': "import * as store from '@ng-native/expo/store';\n",
    'src/app/legacy.js': "const { Storage } = require('@ng-native/expo/store');\n",
    'src/app/player.test.ts':
      "import { vi } from 'vitest';\nvi.mock('@ng-native/expo/player', () => ({}));\n",
  };

  it('imports each moved name from its new entry point, and notes what it cannot split', async () => {
    const { nx, angular, cli } = await acrossAdapters(files, 'split-store-and-player', '0.2.0');
    assert.equal(
      nx.files['src/app/settings.ts'],
      [
        '// Settings, kept on the device.',
        "import { Injectable, inject } from '@angular/core';",
        "import { type NativeStore, Store } from '@ng-native/expo/store';",
        "import { SecureStorage } from '@ng-native/expo/secure-store';",
        "import { Storage as Prefs } from '@ng-native/expo/async-storage';",
        "import { StoreReview } from '@ng-native/expo/store-review';",
        "import type { Player } from '@ng-native/expo/player';",
        'import { audioPlayer } from "@ng-native/expo/audio"',
        'import { videoPlayer } from "@ng-native/expo/video"',
        '',
        "export { Storage } from '@ng-native/expo/async-storage';",
        '',
      ].join('\n'),
    );
    for (const file of ['src/app/all.ts', 'src/app/legacy.js', 'src/app/player.test.ts']) {
      assert.equal(nx.files[file], files[file as keyof typeof files]);
    }
    const store =
      "Import Storage from '@ng-native/expo/async-storage' and SecureStorage from '@ng-native/expo/secure-store' instead.";
    assert.deepEqual(nx.notes, [
      `src/app/all.ts:1: A namespace import cannot be split automatically. ${store}`,
      `src/app/legacy.js:1: require('@ng-native/expo/store') cannot be split automatically. ${store}`,
      "src/app/player.test.ts:2: vi.mock('@ng-native/expo/player') cannot be split automatically. Import audioPlayer from '@ng-native/expo/audio' and videoPlayer from '@ng-native/expo/video' instead.",
    ]);
    assert.deepEqual(angular, nx);
    assert.deepEqual(cli, nx);
  });

  it('changes nothing the second time', async () => {
    const first = await viaNx(files, 'split-store-and-player');
    const again = await viaNx(first.files as Record<string, string>, 'split-store-and-player');
    assert.deepEqual(again.files, first.files);
  });
});

describe('tracking-available-getter, through nx migrate, ng update and ng-native-migrate', () => {
  const files = {
    'src/app/privacy.ts': [
      "import { Component, inject } from '@angular/core';",
      "import { Biometrics } from '@ng-native/expo/biometrics';",
      "import { Tracking as Ads } from '@ng-native/expo/tracking';",
      '',
      '@Component({',
      "  selector: 'app-privacy',",
      '  template: `@if (tracking.available()) { <text>Ask</text> }`,',
      '})',
      'export class Privacy {',
      '  protected readonly tracking = inject(Ads);',
      '  private readonly biometrics = inject(Biometrics);',
      '',
      '  async ask(): Promise<boolean> {',
      '    return this.tracking.available() && (await this.biometrics.available());',
      '  }',
      '}',
      '',
      'export const supported = (ads: Ads) => ads.available() || inject(Ads).available();',
      '',
    ].join('\n'),
    'src/app/settings.ts': [
      "import { Component, inject } from '@angular/core';",
      "import { Tracking } from '@ng-native/expo/tracking';",
      '',
      "@Component({ selector: 'app-settings', templateUrl: './settings.html' })",
      'export class Settings {',
      '  readonly ads = inject(Tracking);',
      '}',
      '',
    ].join('\n'),
    'src/app/settings.html': "<text>{{ ads.available() ? 'on' : 'off' }}</text>\n",
    'src/app/everything.ts': "import * as tracking from '@ng-native/expo/tracking';\n",
    // A template that declares its own name for what the component calls tracking.
    'src/app/local.ts': [
      "import { Component, inject } from '@angular/core';",
      "import { Tracking } from '@ng-native/expo/tracking';",
      '',
      '@Component({',
      "  selector: 'app-local',",
      '  template: `@let tracking = other; {{ tracking.available() }}`,',
      '})',
      'export class Local {',
      '  readonly tracking = inject(Tracking);',
      '  readonly other = { available: () => true };',
      '}',
      '',
    ].join('\n'),
    // \`this\` that is not the class's, and a static member sharing an instance member's name.
    'src/app/this.ts': [
      "import { Component as View, inject } from '@angular/core';",
      "import { Tracking } from '@ng-native/expo/tracking';",
      '',
      'export class Nested {',
      '  constructor(private readonly x: Tracking) {}',
      '  go() {',
      '    function helper(this: { x: { available(): boolean } }) {',
      '      return this.x.available();',
      '    }',
      '    const box = { x: { available: () => true }, check() { return this.x.available(); } };',
      '    return [helper, box];',
      '  }',
      '}',
      '',
      'export class Both {',
      '  x = { available: () => true };',
      '  static x: Tracking = inject(Tracking);',
      '  go() {',
      '    return this.x.available();',
      '  }',
      '  static ask() {',
      '    return this.x.available();',
      '  }',
      '}',
      '',
      "@View({ selector: 'app-aliased', template: `{{ ads.available() }}` })",
      'export class Aliased {',
      '  readonly ads = inject(Tracking);',
      '}',
      '',
    ].join('\n'),
    // Two classes, one name: only the one that holds a Tracking changes.
    'src/app/two.ts': [
      "import { Component, inject } from '@angular/core';",
      "import { Biometrics } from '@ng-native/expo/biometrics';",
      "import { Tracking } from '@ng-native/expo/tracking';",
      '',
      'export class Ads {',
      '  readonly service = inject(Tracking);',
      '  read() {',
      '    return this.service.available();',
      '  }',
      '}',
      '',
      '@Component({',
      "  selector: 'app-lock',",
      '  template: `@if (service.available()) { <text>Lock</text> }`,',
      '})',
      'export class Lock {',
      '  readonly service = inject(Biometrics);',
      '  check() {',
      '    return this.service.available();',
      '  }',
      '}',
      '',
      'export function inside(service: Biometrics) {',
      '  return service.available();',
      '}',
      '',
    ].join('\n'),
    'src/app/unrelated.ts':
      'export const ready = (scanner: { available(): boolean }) => scanner.available();\n',
  };

  it("reads Tracking's available as a property, in code and in templates, and nothing else's", async () => {
    const { nx, angular, cli } = await acrossAdapters(files, 'tracking-available-getter', '0.2.0');
    const privacy = nx.files['src/app/privacy.ts']!;
    assert.match(privacy, /template: `@if \(tracking\.available\) \{/);
    assert.match(
      privacy,
      /return this\.tracking\.available && \(await this\.biometrics\.available\(\)\);/,
    );
    assert.match(privacy, /\(ads: Ads\) => ads\.available \|\| inject\(Ads\)\.available;/);
    assert.equal(nx.files['src/app/settings.ts'], files['src/app/settings.ts']);
    assert.equal(
      nx.files['src/app/settings.html'],
      "<text>{{ ads.available ? 'on' : 'off' }}</text>\n",
    );
    assert.equal(nx.files['src/app/unrelated.ts'], files['src/app/unrelated.ts']);
    const two = nx.files['src/app/two.ts']!;
    assert.match(two, /class Ads \{[^}]*return this\.service\.available;/s);
    assert.match(
      two,
      /template: `@if \(service\.available\(\)\)/,
      "Lock's template is Biometrics'",
    );
    assert.match(two, /check\(\) \{\n    return this\.service\.available\(\);/);
    assert.match(two, /inside\(service: Biometrics\) \{\n  return service\.available\(\);/);
    const self = nx.files['src/app/this.ts']!;
    assert.match(
      self,
      /return this\.x\.available\(\);\n    \}\n    const box/,
      'not the class this',
    );
    assert.match(self, /check\(\) \{ return this\.x\.available\(\); \}/, "the object's this");
    assert.match(self, /go\(\) \{\n    return this\.x\.available\(\);/, 'the instance x');
    assert.match(self, /static ask\(\) \{\n    return this\.x\.available;/, 'the static x');
    assert.match(self, /template: `\{\{ ads\.available \}\}`/, '@Component under another name');
    assert.equal(nx.files['src/app/local.ts'], files['src/app/local.ts'], 'its own tracking');
    assert.deepEqual(nx.notes, [
      "src/app/everything.ts:1: A namespace import of '@ng-native/expo/tracking' cannot be followed automatically. Tracking's available is now a property: read it as tracking.available, without calling it.",
      "src/app/local.ts:6: The template declares a tracking of its own, so it was left as it is. Where it reads the component's Tracking, read tracking.available without calling it.",
    ]);
    assert.deepEqual(angular, nx);
    assert.deepEqual(cli, nx);
  });

  it('changes nothing the second time', async () => {
    const first = await viaNx(files, 'tracking-available-getter');
    const again = await viaNx(first.files as Record<string, string>, 'tracking-available-getter');
    assert.deepEqual(again.files, first.files);
  });
});

describe('device-react-native-import, through nx migrate, ng update and ng-native-migrate', () => {
  const files = {
    'src/app/scale.ts': [
      "import { Screen, reactNative, type ReactNative } from '@ng-native/device';",
      'export const scale = () => reactNative()?.PixelRatio.get() ?? 1;',
      '',
    ].join('\n'),
    'src/app/fine.ts': "import { Screen } from '@ng-native/device';\n",
    'src/app/index.ts': "export { reactNative } from '@ng-native/device';\n",
  };

  it('says where each import of the React Native loader is, and changes nothing', async () => {
    const { nx, angular, cli } = await acrossAdapters(files, 'device-react-native-import', '0.2.0');
    assert.equal(nx.files['src/app/scale.ts'], files['src/app/scale.ts']);
    assert.deepEqual(nx.notes, [
      "src/app/index.ts:1: reactNative is no longer exported from '@ng-native/device'. Import what you use from 'react-native' directly.",
      "src/app/scale.ts:1: reactNative and ReactNative are no longer exported from '@ng-native/device'. Import what you use from 'react-native' directly.",
    ]);
    assert.deepEqual(angular, nx);
    assert.deepEqual(cli, nx);
  });
});

describe('ng-native-migrate', () => {
  const app = {
    'package.json': JSON.stringify({ dependencies: { '@ng-native/components': '^0.1.3' } }),
  };

  function run(args: string[], files: Record<string, string>) {
    const dir = mkdtempSync(path.join(tmpdir(), 'ng-native-migrate-'));
    try {
      for (const [file, text] of Object.entries(files)) writeFileSync(path.join(dir, file), text);
      const result = spawnSync(process.execPath, [cli, ...args, dir], { encoding: 'utf8' });
      return { ...result, manifest: readFileSync(path.join(dir, 'package.json'), 'utf8') };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('updates from the @ng-native version package.json lists, and says what it changed', () => {
    const { status, stdout, manifest } = run([], app);
    assert.equal(status, 0);
    assert.match(
      stdout,
      new RegExp(`Migrating from 0\\.1\\.3 to ${own.version.replace(/\./g, '\\.')}`),
    );
    assert.match(stdout, /^UPDATE package\.json$/m);
    assert.match(stdout, /^NOTE Run npm install/m);
    assert.equal(JSON.parse(manifest).dependencies['@ng-native/components'], `^${own.version}`);
  });

  it('writes nothing on a dry run, and still says what it would change', () => {
    const { files, output } = viaCli(app, '0.1.3', ['--dry-run']);
    assert.equal(files['package.json'], app['package.json']);
    assert.match(output, /^UPDATE package\.json$/m);
    assert.match(output, /Dry run: nothing was written\./);
  });

  it('asks for --from when package.json lists no @ng-native version', () => {
    const { status, stderr } = run([], { 'package.json': '{"dependencies":{}}' });
    assert.equal(status, 1);
    assert.match(stderr, /--from/);
  });

  it('stops at its own version, as nx migrate and ng update stop at the one they update to', () => {
    // A migration a later release brings is in no published copy of this package; one registered
    // above this package's version is that case.
    const later = {
      name: 'from-a-later-release',
      version: '999.0.0',
      description: 'Not this release.',
      run: () => ['ran'],
    };
    migrations.push(later);
    const log = console.log;
    const lines: string[] = [];
    console.log = (line: string) => lines.push(line);
    const dir = mkdtempSync(path.join(tmpdir(), 'ng-native-migrate-'));
    try {
      writeFileSync(path.join(dir, 'package.json'), app['package.json']);
      const status = main(['--from', '0.1.3', '--dry-run', dir]);
      assert.equal(status, 0);
      assert.ok(lines.some((line) => line.startsWith('- sync-app-versions')));
      assert.ok(!lines.some((line) => line.includes('from-a-later-release')));
      assert.ok(!lines.includes('NOTE ran'));
    } finally {
      console.log = log;
      migrations.splice(migrations.indexOf(later), 1);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does nothing for an app already on this version', () => {
    const { status, stdout, manifest } = run(['--from', own.version], app);
    assert.equal(status, 0);
    assert.match(stdout, /Nothing to migrate/);
    assert.equal(manifest, app['package.json']);
  });
});
