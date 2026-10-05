/**
 * Where a development reload leaves the app's history, and finds it again.
 *
 * An edit that cannot be applied to the running app reloads it, and the reload takes the
 * JavaScript runtime with it, the history included: the app came back on its first route, however
 * deep the page being worked on was. Nothing in the app outlives the reload, so the history is
 * left with the dev server, which `withAngularNative` teaches to hold it, and collected by the app
 * that comes back. That app goes through it again, one navigation a page, so each page is a
 * screen with the ones before it beneath and Back retraces them.
 *
 * Only a reload the app started parks anything, and what is parked is handed back once: an app
 * launched afresh, or reloaded from the dev menu, starts where it always does.
 *
 * Page state is not history. A reload still makes every component and service again.
 */
import { InjectionToken } from '@angular/core';
import type { ScreenPresentation } from './screen-presentation.ts';

/** One page of the history: where it is, and how it arrived if not as a plain push. */
export interface ParkedPage {
  url: string;
  presentation?: ScreenPresentation;
}

export interface RouteParking {
  /** Leave the history, oldest first, for the app that comes back. */
  park(pages: ParkedPage[]): Promise<void>;
  /** The history a reload left, once; null when none did. */
  collect(): Promise<ParkedPage[] | null>;
}

declare const __DEV__: boolean | undefined;

/** Long enough for a dev server on the same network, and short enough not to hold a reload up. */
const PARKS_WITHIN = 1000;
/**
 * Longer, for an app that is starting: its thread is busy loading itself, and a timer that ran
 * out in the meantime is answered before the response that arrived first. On an Android emulator
 * a second was not enough, and the history was taken from the dev server and thrown away.
 */
const COLLECTS_WITHIN = 4000;

/** Null where there is no dev server to park with: a release build, a test, the web. */
export const ROUTE_PARKING = new InjectionToken<RouteParking | null>(
  'angular-native.routeParking',
  { factory: devServerParking },
);

function devServerParking(): RouteParking | null {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return null;
  let bundle: string | undefined;
  try {
    // Required, and by its own path: React Native does not export it, and ships Flow, which Node
    // cannot parse, so nothing here can be imported where a test runs.
    // @ts-ignore `require` has a type only where the app's tsconfig loads one.
    const module = require('react-native/Libraries/Core/Devtools/getDevServer') as DevServer;
    const server = (module.default ?? module)();
    if (server.bundleLoadedFromServer) bundle = server.fullBundleUrl ?? server.url;
  } catch {
    // No React Native under us.
  }
  const origin = /^https?:\/\/[^/]+/.exec(bundle ?? '')?.[0];
  if (!origin) return null;
  const at = `${origin}/__ng-native/route?app=${/[?&]platform=(\w+)/.exec(bundle!)?.[1] ?? ''}`;
  const ask = (within: number, init?: RequestInit) =>
    Promise.race([
      fetch(at, init),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), within)),
    ]);
  return {
    park: (pages) =>
      ask(PARKS_WITHIN, { method: 'POST', body: JSON.stringify(pages) }).then(() => {}),
    // A dev server that does not know the address answers with a page, not a history.
    collect: () =>
      ask(COLLECTS_WITHIN)
        .then((response) => (response.ok ? response.json() : null))
        .then((pages: unknown) => (Array.isArray(pages) ? (pages as ParkedPage[]) : null))
        .catch(() => null),
  };
}

type GetDevServer = () => { url: string; fullBundleUrl?: string; bundleLoadedFromServer: boolean };
type DevServer = GetDevServer & { default?: GetDevServer };
