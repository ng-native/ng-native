/**
 * The device test host: the app boots into this instead of its own root component, and stays open
 * while Vitest runs component tests in it, as many times as it likes.
 *
 * It long-polls the Vitest pool (`devicePool()` in `@ng-native/testing/device/pool`) and plays the
 * part of a Vitest worker: Vitest's runner and `expect` run here on Hermes, and each test file is
 * defined in the running app from what the pool sends, sharing its Angular and engine.
 */
import { Component, signal, ViewContainerRef, viewChild } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { getFabricUIManager } from '@ng-native/fabric';
import { mount, type MountResult } from '@ng-native/platform';
import { record } from './recorder.ts';
import { setHarness } from './harness.ts';
import { hashes, modules } from './loader.ts';
import { DEFAULT_PORT } from './port.ts';
import { runFiles, serializeError, type RunRequest } from './run.ts';
import { readRequest } from './wire.ts';

/** React Native's own modules, which only a device has: a `require` Node never runs. */
interface ReactNative {
  AppRegistry: {
    registerRunnable(name: string, runnable: (params: { rootTag: number | string }) => void): void;
  };
  NativeModules: Record<string, unknown>;
  Platform: { OS: string };
}
declare const require: (id: string) => unknown;
const reactNative = (): ReactNative => require('react-native') as ReactNative;

export interface DeviceTestsOptions {
  /**
   * What the app passes `mount()` as its options: providers, global styles, asset resolution. A
   * function is called at each mount, so the conditions it reads (size, theme) are the device's
   * then, as when Android recreates the activity, not when the entry loaded.
   */
  mount?: MountOptions | (() => MountOptions);
  /**
   * The pool's URL. Default: port 51730 on the machine running Vitest, which an iOS simulator
   * reaches at 127.0.0.1 and an Android emulator at 10.0.2.2.
   */
  url?: string;
  /**
   * What the host waits for before it mounts, as the app's own entry does before its `mount()`:
   * `() => loadFonts(styles)` registers the faces the app's sheets declare, so tests render in them
   * rather than in the fallback face. Called at each mount, like `mount`. When it rejects, the host
   * still connects, and each test file it is sent fails with the error; an app that mounts in the
   * fallback face instead catches it, `() => loadFonts(styles).catch(() => undefined)`.
   */
  beforeMount?: () => unknown;
  /** What the app does to its mount besides its options, such as adding a global sheet. */
  onMount?: (app: MountResult) => void;
}

@Component({
  selector: 'device-test-host',
  imports: [Text, View],
  template: `
    <view style="flex: 1">
      @if (status()) {
        <text style="margin: 80px 24px; font-size: 15px; color: #666">{{ status() }}</text>
      }
      <ng-container #slot />
    </view>
  `,
})
class DeviceTestHost {
  readonly slot = viewChild.required('slot', { read: ViewContainerRef });
  readonly status = signal('Waiting for Vitest');
}

type MountOptions = NonNullable<Parameters<typeof mount>[3]>;

const mountOptions = (given: DeviceTestsOptions['mount']): MountOptions =>
  typeof given === 'function' ? given() : (given ?? {});

/** Register the app's runnable as the device test host. Call it instead of the app's own. */
export function startDeviceTests(options: DeviceTestsOptions = {}): void {
  const { AppRegistry } = reactNative();
  AppRegistry.registerRunnable('main', ({ rootTag }) => {
    const start = (failure: Error | null) => {
      const recorder = record(getFabricUIManager());
      const app = mount(
        Number(rootTag),
        DeviceTestHost,
        recorder.fabric,
        mountOptions(options.mount),
      );
      options.onMount?.(app);
      void Promise.all([rootComponent(app), poolUrl(options.url)]).then(([host, url]) => {
        setHarness({ app, recorder, slot: () => host.slot(), pool: { url, session } });
        const status = (text: string) => {
          host.status.set(failure ? failure.message : text);
          app.applicationRef.tick();
        };
        if (failure) status('');
        // After a failed beforeMount, each test file fails with its error rather than running.
        void serve(url, status, failure ? () => Promise.reject(failure) : runFiles);
      });
    };
    if (!options.beforeMount) return start(null);
    void Promise.resolve()
      .then(options.beforeMount)
      .then(
        () => start(null),
        (error: unknown) => {
          const failure = beforeMountFailed(error);
          console.error(failure);
          start(failure);
        },
      );
  });
}

/** What each test file fails with when the app's `beforeMount` rejected, with its error. */
function beforeMountFailed(error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error);
  const failure = new Error(
    `No test ran: the beforeMount given to startDeviceTests() rejected: ${reason}`,
  );
  if (error instanceof Error && error.stack) failure.stack = `${failure.message}\n${error.stack}`;
  return failure;
}

/**
 * The host component once it is made: at once on a phone, and on an OS with windows (macOS) as the
 * main window opens, a round trip to the host after `mount`.
 */
async function rootComponent(app: MountResult): Promise<DeviceTestHost> {
  for (;;) {
    const root = app.applicationRef.components[0];
    if (root) return root.instance as DeviceTestHost;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

/** A message from the pool: Vitest's own worker request, with what the app needs added. */
interface Request {
  __vitest_worker_request__: true;
  type: 'start' | 'run' | 'collect' | 'stop' | 'cancel';
  /** The pool's id for the request, which the answer to it carries back. */
  deviceRequest?: number;
  context?: RunRequest['context'] & { config?: Record<string, unknown> };
  files?: RunRequest['files'];
}

/** This launch of the app, to the pool: a reload is a new session. */
const session = Math.random().toString(36).slice(2) + Date.now().toString(36);

async function serve(
  url: string,
  status: (text: string) => void,
  run: typeof runFiles,
): Promise<void> {
  let config: Record<string, unknown> = {};
  let reply: unknown = null;
  for (;;) {
    let request: Request | null;
    try {
      const response = await fetch(`${url}/poll`, {
        method: 'POST',
        body: JSON.stringify(poll(reply)),
      });
      request = readRequest(await response.text()) as Request | null;
    } catch {
      status(`Waiting for Vitest at ${url}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    reply = null;
    if (!request) continue;
    const { deviceRequest } = request;
    const respond = (type: string, error?: unknown) =>
      (reply = {
        __vitest_worker_response__: true,
        type,
        deviceRequest,
        ...(error ? { error } : {}),
      });
    try {
      if (request.type === 'start') {
        config = request.context?.config ?? {};
        respond('started');
      } else if (request.type === 'run' || request.type === 'collect') {
        status('');
        await run(url, session, request as RunRequest, config);
        status('Waiting for Vitest');
        respond('testfileFinished');
      } else if (request.type === 'stop') {
        respond('stopped');
      }
    } catch (error) {
      status('Waiting for Vitest');
      respond(request.type === 'start' ? 'started' : 'testfileFinished', serializeError(error));
    }
  }
}

/**
 * Where the pool is: `url` when given; or at the host the app loads its bundle from, on the port
 * that host's Metro says the pool started it for (`withDeviceTests` answers
 * `/ng-native/device-tests`); or else port 51730 on the machine running Vitest, which an iOS
 * simulator reaches at 127.0.0.1 and an Android emulator at 10.0.2.2.
 */
async function poolUrl(url: string | undefined): Promise<string> {
  if (url) return url;
  const fallback = `http://${reactNative().Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1'}:${DEFAULT_PORT}`;
  const metro = /^https?:\/\/[^/]+/.exec(scriptUrl())?.[0];
  if (!metro) return fallback;
  try {
    const response = await fetch(`${metro}/ng-native/device-tests`);
    const { port } = (await response.json()) as { port?: number | null };
    return port ? `${metro.replace(/:\d+$/, '')}:${port}` : fallback;
  } catch {
    // A Metro without `withDeviceTests` answers nothing to ask.
    return fallback;
  }
}

/** The URL the app's own bundle came from. */
function scriptUrl(): string {
  const constants = (
    reactNative().NativeModules['SourceCode'] as
      { getConstants?: () => { scriptURL?: string } } | undefined
  )?.getConstants?.();
  return constants?.scriptURL ?? '';
}

/**
 * What the app tells the pool with each poll: who it is, where its own bundle came from, and which
 * modules it has, with a hash of each one a pool sent it, so the pool sends only what is missing
 * or has changed.
 */
function poll(reply: unknown) {
  return {
    session,
    platform: reactNative().Platform.OS,
    script: scriptUrl(),
    defined: [...modules().keys()],
    hashes: Object.fromEntries(hashes),
    reply,
  };
}
