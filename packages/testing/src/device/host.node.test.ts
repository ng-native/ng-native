/** What the device test host does before it mounts: the app's `beforeMount`, awaited. */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { MountResult } from '@ng-native/platform';
import { createFakeFabric } from '../test-utils.ts';
import { startDeviceTests } from './host.ts';
import { writeRequest } from './wire.ts';

type Runnable = (params: { rootTag: number }) => void;

interface Poll {
  reply: { type?: string; error?: { message: string; stack?: string } } | null;
}

const globals = globalThis as unknown as Record<string, unknown>;
const saved = ['require', 'fetch', 'nativeFabricUIManager', '__r'] as const;
const consoleError = console.error;
let restore: Record<string, unknown> = {};
let runnable: Runnable | undefined;
/** Each poll the host sent, and what it fetched besides. */
let polls: Poll[];
let otherFetches: string[];
/**
 * What the pool answers each poll with, in order, or a promise of it; after the last, a poll never
 * returns.
 */
let answers: unknown[];
/** Every app the host mounted, destroyed after each test. */
let mounted: MountResult[];

beforeEach(() => {
  restore = Object.fromEntries(saved.map((name) => [name, globals[name]]));
  runnable = undefined;
  polls = [];
  otherFetches = [];
  answers = [];
  mounted = [];
  globals['nativeFabricUIManager'] = createFakeFabric();
  // Metro's require, which the host reads the modules it has from.
  globals['__r'] = { getModules: () => new Map() };
  globals['require'] = (id: string) => {
    assert.equal(id, 'react-native');
    return {
      AppRegistry: { registerRunnable: (_: string, run: Runnable) => (runnable = run) },
      NativeModules: {},
      Platform: { OS: 'ios' },
    };
  };
  globals['fetch'] = (url: string, init?: { body?: string }) => {
    if (!url.endsWith('/poll')) {
      otherFetches.push(url);
      return new Promise(() => {});
    }
    polls.push(JSON.parse(init?.body ?? '{}') as Poll);
    if (!answers.length) return new Promise(() => {});
    const answer = answers.shift();
    return Promise.resolve(answer).then((request) => ({ text: async () => writeRequest(request) }));
  };
});

afterEach(() => {
  for (const app of mounted) app.applicationRef.destroy();
  console.error = consoleError;
  for (const name of saved) {
    if (restore[name] === undefined) delete globals[name];
    else globals[name] = restore[name];
  }
});

/** Until `done()` holds, or a second has passed. */
async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('the device test host', () => {
  it('mounts and polls the pool only once beforeMount has resolved', async () => {
    let resolve!: () => void;
    startDeviceTests({
      url: 'http://pool.test',
      beforeMount: () => new Promise<void>((done) => (resolve = done)),
      onMount: (app) => mounted.push(app),
    });
    runnable?.({ rootTag: 1 });
    await new Promise((done) => setTimeout(done, 50));
    assert.equal(mounted.length, 0, 'mounted before beforeMount resolved');
    assert.equal(polls.length, 0, 'polled before beforeMount resolved');

    resolve();
    await until(() => polls.length > 0);
    assert.equal(mounted.length, 1);
    assert.equal(polls.length, 1);
    const host = mounted[0]?.applicationRef.components[0]?.instance as { status(): string };
    assert.equal(host.status(), 'Waiting for Vitest');
  });

  it('still connects when beforeMount rejects, and fails each test file with its error', async () => {
    const logged: unknown[] = [];
    let sendRun!: (request: unknown) => void;
    console.error = (...args: unknown[]) => logged.push(...args);
    answers = [
      { __vitest_worker_request__: true, type: 'start', deviceRequest: 1, context: {} },
      new Promise((resolve) => (sendRun = resolve)),
    ];
    startDeviceTests({
      url: 'http://pool.test',
      beforeMount: () => Promise.reject(new Error('expo-font is not installed')),
      onMount: (app) => mounted.push(app),
    });
    runnable?.({ rootTag: 1 });
    await until(() => polls.length >= 2);

    // Connected, and saying why nothing will run before a test file arrives.
    assert.equal(mounted.length, 1);
    const host = mounted[0]?.applicationRef.components[0]?.instance as { status(): string };
    assert.match(host.status(), /^No test ran: the beforeMount given/);
    assert.match(String(logged[0]), /beforeMount given to startDeviceTests\(\) rejected/);

    sendRun({
      __vitest_worker_request__: true,
      type: 'run',
      deviceRequest: 2,
      context: {},
      files: [{ filepath: '/app/src/a.device.ts' }],
    });
    await until(() => polls.length >= 3);
    assert.deepEqual(
      polls.map(({ reply }) => reply && [reply.type, reply.error?.message ?? null]),
      [
        null,
        ['started', null],
        [
          'testfileFinished',
          'No test ran: the beforeMount given to startDeviceTests() rejected: ' +
            'expo-font is not installed',
        ],
      ],
    );
    // The stack Vitest shows is the one beforeMount's error has.
    assert.match(polls[2]?.reply?.error?.stack ?? '', /host\.node\.test\.ts/);
    assert.deepEqual(otherFetches, [], 'ran the test file');
    assert.match(host.status(), /^No test ran: the beforeMount given/);
  });

  it('calls beforeMount again at each mount', async () => {
    let calls = 0;
    startDeviceTests({
      url: 'http://pool.test',
      beforeMount: async () => calls++,
      onMount: (app) => mounted.push(app),
    });
    runnable?.({ rootTag: 1 });
    await until(() => polls.length >= 1);
    // As when Android recreates the activity: the runnable again, with a new root.
    runnable?.({ rootTag: 11 });
    await until(() => polls.length >= 2);
    assert.equal(calls, 2);
    assert.equal(mounted.length, 2);
  });

  // As before beforeMount: an app without one mounts in the runnable call itself.
  it('mounts at once when there is no beforeMount', async () => {
    startDeviceTests({ url: 'http://pool.test', onMount: (app) => mounted.push(app) });
    runnable?.({ rootTag: 1 });
    assert.equal(mounted.length, 1);
    // The host's poll, left waiting, so it does not poll again once the test has ended.
    await until(() => polls.length > 0);
    assert.equal(polls.length, 1);
  });
});
