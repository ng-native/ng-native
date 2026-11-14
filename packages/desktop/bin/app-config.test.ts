import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

import { desktopAppConfig, pluginOptions } from './app-config.mjs';

const require = createRequire(import.meta.url);
const withNgNativeDesktop = require('../app.plugin.cjs') as (
  config: object,
  options: unknown,
) => object;

describe('the config plugin', () => {
  it('returns the config unchanged when the options are valid, or absent', () => {
    const config = { name: 'Demo', platforms: ['macos'] };
    assert.equal(withNgNativeDesktop(config, undefined), config);
    assert.equal(
      withNgNativeDesktop(config, {
        documentTypes: [{ name: 'Markdown', extensions: ['md'] }],
        capabilities: { spawn: [{ program: 'git', args: ['status'] }], env: ['HOME'] },
        deny: ['react-native-reanimated'],
      }),
      config,
    );
  });

  it('stops with every problem listed, so expo config fails on a misspelt option', () => {
    assert.throws(
      () =>
        withNgNativeDesktop(
          {},
          { capabilites: {}, documentTypes: [{ name: 'X', extensions: [] }] },
        ),
      (error: Error) =>
        /The plugin options in app.json are not valid/.test(error.message) &&
        /capabilites: is not an option/.test(error.message) &&
        /documentTypes\[0\]\.extensions: at least one extension is required/.test(error.message),
    );
  });
});

describe('pluginOptions', () => {
  it('finds the options of the plugin entry, and none for a bare entry', () => {
    const options = { deny: ['a'] };
    assert.equal(
      pluginOptions({ plugins: ['@ng-native/metro', ['@ng-native/desktop', options]] }),
      options,
    );
    assert.equal(pluginOptions({ plugins: ['@ng-native/desktop'] }), undefined);
    assert.equal(pluginOptions({}), undefined);
  });
});

describe('desktopAppConfig', () => {
  it('reads each setting from the Expo key iOS reads it from', () => {
    const config = desktopAppConfig({
      name: 'Notes',
      slug: 'notes',
      version: '2.1.0',
      scheme: ['notes', 'notes-dev'],
      icon: './assets/icon.png',
      runtimeVersion: '2.1',
      updates: { url: 'https://updates.example.com/manifest' },
      ios: {
        bundleIdentifier: 'com.example.notes',
        buildNumber: '42',
        scheme: 'notes',
        icon: './assets/notes.icon',
        infoPlist: { NSMicrophoneUsageDescription: 'Dictation' },
      },
      plugins: [
        ['expo-camera', { cameraPermission: 'Scan documents' }],
        ['@ng-native/desktop', { deny: ['react-native-reanimated'] }],
      ],
    });
    assert.deepEqual(config, {
      name: 'Notes',
      version: '2.1.0',
      buildNumber: '42',
      bundleIdentifier: 'com.example.notes',
      schemes: ['notes', 'notes-dev'],
      icon: './assets/notes.icon',
      updatesUrl: 'https://updates.example.com/manifest',
      runtimeVersion: '2.1',
      permissions: {
        usageStrings: {
          NSMicrophoneUsageDescription: 'Dictation',
          NSCameraUsageDescription: 'Scan documents',
        },
        sandboxEntitlements: [
          'com.apple.security.device.audio-input',
          'com.apple.security.device.camera',
        ],
      },
      options: { deny: ['react-native-reanimated'] },
    });
  });

  it('falls back where an app sets less: a desktop-only app has no ios keys', () => {
    const config = desktopAppConfig({ slug: 'notes', icon: './assets/icon.png' });
    assert.equal(config.name, 'notes');
    assert.equal(config.version, '1.0.0');
    assert.equal(config.buildNumber, '1.0.0');
    assert.equal(config.bundleIdentifier, null);
    assert.deepEqual(config.schemes, []);
    assert.equal(config.icon, './assets/icon.png');
    assert.equal(config.updatesUrl, null);
    assert.equal(config.runtimeVersion, null);
    assert.deepEqual(config.options, {});
  });

  it('takes the light variant of an icon with variants, and no updates URL when updates are off', () => {
    const config = desktopAppConfig({
      icon: './assets/icon.png',
      ios: { icon: { light: './assets/light.png', dark: './assets/dark.png' } },
      updates: { url: 'https://updates.example.com', enabled: false },
      // A policy is resolved by Expo's own tools, which the desktop build does not run.
      runtimeVersion: { policy: 'appVersion' },
    });
    assert.equal(config.icon, './assets/light.png');
    assert.equal(config.updatesUrl, null);
    assert.equal(config.runtimeVersion, null);
  });

  it('throws on options the plugin would refuse', () => {
    assert.throws(
      () => desktopAppConfig({ plugins: [['@ng-native/desktop', { deny: ['Not A Package'] }]] }),
      /deny\[0\]: is not an npm package name/,
    );
  });
});
