/**
 * What each of the canary's screens sends native, written out for `scripts/native-output.mjs` to
 * compare between two checkouts: the views, in order, with the props each is committed with. A
 * change to how anything draws or lays out changes a prop here first.
 *
 * Runs only when `NATIVE_OUTPUT` names the directory to write to, and is skipped otherwise:
 *
 *   NATIVE_OUTPUT=/tmp/out pnpm --filter canary exec vitest run src/native-output.test.ts
 *
 * The clock, `performance.now` and `Math.random` are fixed, so two runs of the same code write the
 * same files: a screen that prints how long it took prints the same time. Each
 * route is rendered in an app of its own, opened at the home screen and navigated to the route.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Router, type Route } from '@angular/router';
import { Engine, styleSheetOf, type StyleSheet } from '@ng-native/fabric';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { afterEach, test, vi } from 'vitest';
import { App } from './app/app.ts';
import { appConfig } from './app/app.config.ts';
import { routes } from './app/app.routes.ts';
import { GlobalStyles } from './app/global-styles.ts';

const OUT = process.env['NATIVE_OUTPUT'];

/**
 * Routes that cannot be rendered in Node, each with why: the report lists them, so a screen left
 * out is never mistaken for one that did not change.
 */
const SKIPPED: Readonly<Record<string, string>> = {
  worklets: 'runs Reanimated worklets, which never yield in Node',
};

/** A value a route's parameter takes, so a page with one renders. */
const PARAM = '1';

/** Every route the app has, as the URL it is opened at. */
function urls(list: readonly Route[], prefix = ''): string[] {
  return list.flatMap((route) => {
    if (route.redirectTo !== undefined || route.path === '**') return [];
    const path = [prefix, route.path ?? ''].filter(Boolean).join('/');
    const url = path.replace(/:[^/]+/g, PARAM);
    return [url, ...urls(route.children ?? [], path)];
  });
}

/** Props that differ from run to run without anything drawing differently. */
const UNSTABLE = new Set(['nativeID']);

/** A committed view as plain data: its name, its props in key order, and its children. */
function plain(node: FakeFabricNode): unknown {
  const props: Record<string, unknown> = {};
  for (const key of Object.keys(node.props).sort()) {
    const value = node.props[key];
    if (typeof value === 'function' || UNSTABLE.has(key)) continue;
    props[key] = rounded(value);
  }
  return { view: node.viewName, props, children: node.children.map(plain) };
}

/** Numbers to a hundredth of a point, so a sum done in another order is the same number. */
function rounded(value: unknown): unknown {
  if (typeof value === 'number') return Math.round(value * 100) / 100;
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, rounded((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** A random source that gives the same numbers every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/** The generated Tailwind sheet, where `node metro.config.js` has built it. */
async function tailwind(): Promise<StyleSheet | null> {
  try {
    const path = '../.angular-native/app.tailwind.js';
    return ((await import(/* @vite-ignore */ path)) as { default: StyleSheet }).default;
  } catch {
    return null;
  }
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const file = (url: string) => `${url.replace(/\//g, '__') || 'home'}.json`;

test.skipIf(!OUT)('lists the screens left out', () => {
  mkdirSync(OUT!, { recursive: true });
  writeFileSync(join(OUT!, 'skipped.txt'), `${JSON.stringify(SKIPPED, null, 1)}\n`);
});

for (const url of urls(routes).filter((each) => !(each in SKIPPED))) {
  test.skipIf(!OUT)(`writes what /${url} sends native`, async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'], now: new Date('2026-01-15T10:00:00Z') });
    vi.spyOn(Math, 'random').mockImplementation(seeded(1));
    const sheet = await tailwind();
    const record = (result: Record<string, unknown>) => {
      mkdirSync(OUT!, { recursive: true });
      const written = { url: `/${url}`, tailwind: !!sheet, ...result };
      writeFileSync(join(OUT!, file(url)), `${JSON.stringify(written, null, 1)}\n`);
    };
    // A screen that throws in Node, for a native module it has not got, is that screen's result:
    // one that throws on one side only is what the comparison is for.
    try {
      const app = await render(App, { providers: appConfig.providers });
      const engine = app.componentRef.injector.get(Engine);
      const global = styleSheetOf(GlobalStyles);
      if (global) engine.addGlobalSheet(global);
      if (sheet) engine.addGlobalSheet(sheet);
      await settle();
      if (url) await app.componentRef.injector.get(Router).navigateByUrl(`/${url}`);
      await settle();
      record({ views: app.fabric.committed.map(plain) });
    } catch (error) {
      record({ threw: String((error as Error).message ?? error).split('\n')[0] });
    }
  });
}
