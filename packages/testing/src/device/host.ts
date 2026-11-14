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
  /** What the app passes `mount()` as its options: providers, global styles, asset resolution. */
  mount?: Parameters<typeof mount>[3];
  /**
   * The pool's URL. Default: port 51730 on the machine running Vitest, which an iOS simulator
   * reaches at 127.0.0.1 and an Android emulator at 10.0.2.2.
   */
  url?: string;
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

/** Register the app's runnable as the device test host. Call it instead of the app's own. */
export function startDeviceTests(options: DeviceTestsOptions = {}): void {
  const { AppRegistry, Platform } = reactNative();
  const url =
    options.url ?? `http://${Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1'}:${DEFAULT_PORT}`;
  AppRegistry.registerRunnable('main', ({ rootTag }) => {
    const recorder = record(getFabricUIManager());
    const app = mount(Number(rootTag), DeviceTestHost, recorder.fabric, options.mount ?? {});
    options.onMount?.(app);
    const host = app.componentRef.instance as DeviceTestHost;
    setHarness({ app, recorder, slot: () => host.slot() });
    void serve(url, (status) => {
      host.status.set(status);
      app.applicationRef.tick();
    });
  });
}

/** A message from the pool: Vitest's own worker request, with what the app needs added. */
interface Request {
  __vitest_worker_request__: true;
  type: 'start' | 'run' | 'collect' | 'stop' | 'cancel';
  context?: RunRequest['context'] & { config?: Record<string, unknown> };
  files?: RunRequest['files'];
}

/** This launch of the app, to the pool: a reload is a new session. */
const session = Math.random().toString(36).slice(2) + Date.now().toString(36);

async function serve(url: string, status: (text: string) => void): Promise<void> {
  let config: Record<string, unknown> = {};
  let reply: unknown = null;
  for (;;) {
    let request: Request | null;
    try {
      const response = await fetch(`${url}/poll`, {
        method: 'POST',
        body: JSON.stringify(poll(reply)),
      });
      request = (await response.json()) as Request | null;
    } catch {
      status(`Waiting for Vitest at ${url}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    reply = null;
    if (!request) continue;
    const respond = (type: string, error?: unknown) =>
      (reply = { __vitest_worker_response__: true, type, ...(error ? { error } : {}) });
    try {
      if (request.type === 'start') {
        config = request.context?.config ?? {};
        respond('started');
      } else if (request.type === 'run' || request.type === 'collect') {
        status('');
        await runFiles(url, session, request as RunRequest, config);
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
 * What the app tells the pool with each poll: who it is, where its own bundle came from, and which
 * modules it has, with a hash of each one a pool sent it, so the pool sends only what is missing
 * or has changed.
 */
function poll(reply: unknown) {
  const { NativeModules, Platform } = reactNative();
  const constants = (
    NativeModules['SourceCode'] as { getConstants?: () => { scriptURL?: string } } | undefined
  )?.getConstants?.();
  return {
    session,
    platform: Platform.OS,
    script: constants?.scriptURL ?? '',
    defined: [...modules().keys()],
    hashes: Object.fromEntries(hashes),
    reply,
  };
}
