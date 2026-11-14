/**
 * The per-OS support table (`OS_SUPPORT` in `@ng-native/device`) against the code: it names every
 * desktop API and every macOS-only input, everything it names exists, and each service it lists
 * reports `available()` as its row says. The documentation site draws its table from the same
 * data, so the page cannot drift from what this test checks.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ProviderToken, Signal } from '@angular/core';
import * as device from '@ng-native/device';
import { OS, OS_SUPPORT, SUPPORT_OSES, type SupportOs } from '@ng-native/device';
import * as components from '@ng-native/components';
import * as router from '@ng-native/router';
import { cleanup, injectService } from '@ng-native/testing';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, root)), 'utf8');

afterEach(cleanup);

/** Every name a row covers. */
const covered = new Set(OS_SUPPORT.flatMap((row) => row.covers));

/**
 * Desktop APIs that do the same on every OS, so a support row would say `yes` five times: the OS
 * tokens, the services that existed before macOS, and the router's history, which every OS keeps.
 */
const ON_EVERY_OS = new Set([
  'OS',
  'OS_VERSION',
  'DESKTOP',
  'APPLE',
  'Dialogs',
  'DeepLinks',
  'Screen',
  'SafeArea',
  'NavigationHistory',
  'AppLifecycle',
  'provideAppLifecycle',
]);

/** The names in the "Where desktop APIs come from" table, by the package they come from. */
function desktopApis(): { name: string; from: string }[] {
  const page = read('apps/documentation/src/content/guide/desktop-imports.md');
  const apis: { name: string; from: string }[] = [];
  for (const line of page.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 4 || !cells[2]?.startsWith('`@ng-native/')) continue;
    const from = cells[2].replace(/`/g, '').split(',')[0]!;
    for (const [, name] of cells[1]!.matchAll(/`([A-Za-z_]+)`/g)) apis.push({ name: name!, from });
  }
  return apis;
}

/**
 * Inputs whose doc comment says they act on macOS and not on iOS, with the class they are on:
 * each component and directive source in the packages that have them.
 */
function macOnlyInputs(): { name: string; cls: string; file: string }[] {
  const found: { name: string; cls: string; file: string }[] = [];
  for (const dir of ['packages/components/src', 'packages/router/src', 'packages/expo/src']) {
    for (const file of readdirSync(fileURLToPath(new URL(dir, root)), { recursive: true })) {
      if (!String(file).endsWith('.ts') || /generated|test/.test(String(file))) continue;
      const source = read(`${dir}/${file}`);
      const inputs = /(\/\*\*(?:(?!\*\/)[\s\S])*\*\/)\s*\n\s*readonly (\w+) = (?:input|model)\b/g;
      for (const match of source.matchAll(inputs)) {
        const doc = match[1]!;
        if (!/macOS/.test(doc) || /\biOS\b/.test(doc)) continue;
        const before = source.slice(0, match.index);
        const cls = [...before.matchAll(/export class (\w+)/g)].at(-1)?.[1] ?? '';
        found.push({ name: match[2]!, cls, file: `${dir}/${file}` });
      }
    }
  }
  return found;
}

describe('the OS support table', () => {
  it('has a cell for each OS in every row, and no row twice', () => {
    const features = OS_SUPPORT.map((row) => row.feature);
    assert.equal(new Set(features).size, features.length);
    for (const row of OS_SUPPORT) {
      assert.deepEqual(Object.keys(row.on).sort(), Object.keys(SUPPORT_OSES).sort(), row.feature);
      for (const cell of Object.values(row.on)) assert.ok(cell.trim(), row.feature);
    }
  });

  it('names every desktop API the imports page lists, other than those on every OS', () => {
    const apis = desktopApis().filter(
      ({ from }) => !from.startsWith('@ng-native/testing') && !from.startsWith('@ng-native/expo'),
    );
    assert.ok(apis.length > 20, `read ${apis.length} names from the imports page`);
    const missing = apis
      .filter(({ name }) => !covered.has(name) && !ON_EVERY_OS.has(name))
      .map(({ name }) => name);
    assert.deepEqual(missing, []);
  });

  it('names every macOS-only input, or the class it is on', () => {
    const inputs = macOnlyInputs();
    assert.ok(inputs.length >= 3, `found ${inputs.length} macOS-only inputs`);
    const missing = inputs
      .filter(({ name, cls }) => !covered.has(name) && !covered.has(cls))
      .map(({ name, file }) => `${file}: ${name}`);
    assert.deepEqual(missing, []);
  });

  it('names every desktop-only event', () => {
    const events = read('packages/metro/dom-events.cjs');
    const desktop = [...events.matchAll(/\['(\w+)', \{[^}]*desktop: '/g)].map((m) => `(${m[1]})`);
    assert.ok(desktop.length >= 8, `found ${desktop.length} desktop events`);
    assert.deepEqual(
      desktop.filter((event) => !covered.has(event)),
      [],
    );
  });

  it('names nothing that does not exist', () => {
    const exported = new Set([
      ...Object.keys(device),
      ...Object.keys(components),
      ...Object.keys(router),
    ]);
    const sources = ['packages/components/src', 'packages/device/src', 'packages/expo/src']
      .flatMap((dir) =>
        readdirSync(fileURLToPath(new URL(dir, root)), { recursive: true })
          .filter((file) => String(file).endsWith('.ts') && !/generated/.test(String(file)))
          .map((file) => read(`${dir}/${file}`)),
      )
      .join('\n');
    const missing = [...covered].filter((name) => {
      if (name.startsWith('(')) return !sources.includes(name.slice(1, -1));
      return !exported.has(name) && !new RegExp(`\\b${name}\\b[?]?\\s*[:=]`).test(sources);
    });
    assert.deepEqual(missing, []);
  });
});

/** A device on `os` whose host has every module a service asks for, or none. */
function on(os: 'ios' | 'macos' | 'android' | 'web', modules: boolean): () => void {
  const host = globalThis as Record<string, unknown>;
  const fabric = Object.getOwnPropertyDescriptor(host, 'nativeFabricUIManager');
  // React Native is reached for only where Fabric is there, as on a device.
  host['nativeFabricUIManager'] ??= {};
  host['require'] = (id: string) => {
    if (id !== 'react-native') throw new Error(`Cannot find module '${id}'`);
    const module = { getConstants: () => ({ multipleWindows: true, menuBar: true, env: {} }) };
    return {
      Platform: { OS: os },
      TurboModuleRegistry: { get: () => (modules ? module : null) },
      DeviceEventEmitter: { addListener: () => ({ remove() {} }) },
    };
  };
  return () => {
    delete host['require'];
    if (fabric) Object.defineProperty(host, 'nativeFabricUIManager', fabric);
    else delete host['nativeFabricUIManager'];
  };
}

/** Modules the JavaScript side has a contract for and the desktop host does not register yet. */
const HOST_OWES = new Set(['NgNativeUndo']);

const PLATFORM: Readonly<Record<SupportOs, 'ios' | 'macos' | 'android' | 'web'>> = {
  macos: 'macos',
  ipados: 'ios',
  iphone: 'ios',
  android: 'android',
  web: 'web',
};

describe('each service the table lists', () => {
  for (const row of OS_SUPPORT) {
    for (const [name, module] of Object.entries(row.services ?? {})) {
      it(`${name} is available where ${row.feature} is, from ${module}`, () => {
        const token = (device as Record<string, unknown>)[name] as ProviderToken<{
          available: Signal<boolean>;
        }>;
        for (const [os, cell] of Object.entries(row.on) as [SupportOs, string][]) {
          const present = cell !== 'absent';
          const restore = on(PLATFORM[os], present);
          try {
            const service = injectService(token, {
              providers: [{ provide: OS, useValue: PLATFORM[os] }],
            });
            assert.equal(service.available(), present, `${name}.available() on ${os}`);
          } finally {
            restore();
            cleanup();
          }
        }
      });
    }
  }

  it('matches the desktop host: a service is on macOS exactly where the host has its module', () => {
    const host = read('packages/desktop/native/appkit/main.mm');
    const registered = new Set(
      [...host.matchAll(/addModule\(\*modules, "(\w+)"/g)].map((m) => m[1]),
    );
    assert.ok(registered.size > 5, `read ${registered.size} modules from the host`);
    const disagree: string[] = [];
    for (const row of OS_SUPPORT) {
      for (const [name, module] of Object.entries(row.services ?? {})) {
        const onMac = row.on.macos !== 'absent';
        if (onMac !== (registered.has(module) || HOST_OWES.has(module))) disagree.push(name);
      }
    }
    assert.deepEqual(disagree, []);
  });

  it('reads each service from the module the table names', () => {
    for (const row of OS_SUPPORT) {
      for (const [name, module] of Object.entries(row.services ?? {})) {
        const file = name.replace(/[A-Z]/g, (letter, at) => (at ? '-' : '') + letter.toLowerCase());
        assert.match(read(`packages/device/src/${file}.ts`), new RegExp(`'${module}'`), name);
      }
    }
  });
});
