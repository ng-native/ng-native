/**
 * Random runs of the navigation facade over a tab bar with a stack in one tab and a page on the
 * app's own stack, checking after every step what must hold whatever the order: each call
 * settles, nothing is reported as an error, and the one page in front is the one the url names.
 *
 * Seeded, so a failure prints the seed and the steps that reach it.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import { ErrorHandler, type Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { cleanup, render, settle } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';
import type { LivePage } from './fixtures/router-fuzz.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/router-fuzz.ts');
});

// A few seconds by default; `ROUTER_FUZZ_SEEDS=600 ROUTER_FUZZ_STEPS=30` searches harder.
const SEEDS = setting('ROUTER_FUZZ_SEEDS', 40);
const FIRST = setting('ROUTER_FUZZ_FIRST', 1);
const STEPS = setting('ROUTER_FUZZ_STEPS', 20);

/** A whole number from the environment, or `fallback`: anything else would run no seeds, and pass. */
function setting(name: string, fallback: number): number {
  const text = process.env[name];
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`${name} must be a whole number above 0`);
  return value;
}

/** mulberry32: small, seeded, and the same on every run. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Step = readonly [name: string, run: (nav: NativeNavigation, router: Router) => unknown];

const SHEETS = ['modal', 'formSheet', 'fullScreenModal'] as const;

function steps(next: () => number): Step {
  const id = 1 + Math.floor(next() * 3);
  const as = SHEETS[Math.floor(next() * SHEETS.length)]!;
  const all: Step[] = [
    [`push /detail/${id}`, (nav) => nav.push(`/detail/${id}`)],
    [`push /library/${id}`, (nav) => nav.push(`/library/${id}`)],
    [`push /library`, (nav) => nav.push('/library')],
    [`push /home`, (nav) => nav.push('/home')],
    [`present /detail/${id} ${as}`, (nav) => nav.present(`/detail/${id}`, { as })],
    [`present /library/${id} ${as}`, (nav) => nav.present(`/library/${id}`, { as })],
    [`present /home ${as}`, (nav) => nav.present('/home', { as })],
    [`replace /detail/${id}`, (nav) => nav.replace(`/detail/${id}`)],
    [`replace /library/${id}`, (nav) => nav.replace(`/library/${id}`)],
    [`reset /home`, (nav) => nav.reset('/home')],
    [`reset /library/${id}`, (nav) => nav.reset(`/library/${id}`)],
    [`back`, (nav) => nav.back()],
    [`back`, (nav) => nav.back()],
    [`back`, (nav) => nav.back()],
    [`popToRoot`, (nav) => nav.popToRoot()],
    [`popTo /library`, (nav) => nav.popTo('/library')],
    [`tab /home`, (_, router) => router.navigateByUrl('/home')],
    [`tab /library`, (_, router) => router.navigateByUrl('/library')],
  ];
  return all[Math.floor(next() * all.length)]!;
}

/** The page the url puts in front: the presented one, or else the primary one. */
function named(url: string): string {
  const path = url.split(/[?#]/, 1)[0]!;
  const presented = /\(presented:([^)]*)\)/.exec(path);
  return (presented ? presented[1]! : path.replace(/\(.*$/, '')).replace(/^\//, '');
}

const within = <T>(work: T, ms = 2000): Promise<T | 'hung'> => {
  let timer: NodeJS.Timeout;
  return Promise.race([
    Promise.resolve(work),
    new Promise<'hung'>((resolve) => (timer = setTimeout(() => resolve('hung'), ms))),
  ]).finally(() => clearTimeout(timer));
};

/** The app under test, and what a run reads of it. */
interface Run {
  readonly router: Router;
  readonly nav: NativeNavigation;
  readonly errors: unknown[];
  readonly trace: string[];
}

const settled = async (turns: number) => {
  for (let turn = 0; turn < turns; turn++) await settle();
};

/** The pages in front, by name. */
const inFront = () =>
  [...(mod['live'] as Set<LivePage>)].filter((page) => page.inFront()).map((page) => page.name());

/** One step: one call, or two started in the same turn. What went wrong, or null. */
async function step(app: Run, next: () => number): Promise<string | null> {
  const together = next() < 0.2 ? 2 : 1;
  const started: unknown[] = [];
  for (let n = 0; n < together; n++) {
    const [name, start] = steps(next);
    app.trace.push(n ? `  + ${name}` : name);
    try {
      started.push(start(app.nav, app.router));
    } catch (error) {
      return `threw ${String(error)}`;
    }
  }
  const done = await within(Promise.allSettled(started));
  if (done === 'hung') return 'a call never settled';
  const rejected = done.find((result) => result.status === 'rejected');
  if (rejected) return `rejected ${String((rejected as PromiseRejectedResult).reason)}`;
  await settled(6);
  return checked(app, '');
}

/** What must hold whenever the app is still: no error, and the page the url names in front. */
function checked(app: Run, when: string): string | null {
  if (app.errors.length) return `reported ${String(app.errors[0])}`;
  const front = inFront();
  app.trace[app.trace.length - 1] += `  -> ${app.router.url} [front: ${front.join(', ')}]`;
  if (front.length !== 1) return `${front.length} pages in front at ${app.router.url}${when}`;
  return front[0] === named(app.router.url)
    ? null
    : `${front[0]} is in front at ${app.router.url}${when}`;
}

async function run(seed: number): Promise<string | null> {
  const next = random(seed);
  const errors: unknown[] = [];
  const rendered = await render(mod['Shell'] as Type<unknown>, {
    providers: [
      provideNativeRouter(mod['routes'] as Routes),
      { provide: ErrorHandler, useValue: { handleError: (error: unknown) => errors.push(error) } },
    ],
  });
  await settle();
  const { injector } = rendered.componentRef;
  const app: Run = {
    router: injector.get(Router),
    nav: injector.get(NativeNavigation),
    errors,
    trace: [],
  };

  let failure: string | null = null;
  for (let at = 0; at < STEPS && !failure; at++) failure = await step(app, next);
  if (!failure) {
    // Back from anywhere ends somewhere, with that page in front.
    for (let back = 0; back < STEPS + 4; back++) {
      app.nav.back();
      await settled(4);
    }
    app.trace.push('back as far as it goes');
    failure = checked(app, ' after backing out');
  }
  return failure && `seed ${seed}: ${failure}\n  ${app.trace.join('\n  ')}`;
}

it('keeps the page the url names in front through random navigation', async () => {
  const failures: string[] = [];
  for (let seed = FIRST; seed < FIRST + SEEDS; seed++) {
    const failure = await run(seed);
    await cleanup();
    (mod['live'] as Set<LivePage>).clear();
    if (failure) failures.push(failure);
  }
  assert.equal(
    failures.length,
    0,
    `${failures.length} of ${SEEDS} runs failed\n${failures.join('\n\n')}`,
  );
});
