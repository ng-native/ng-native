/**
 * Screenshots in a device test: `screenshot()` captures what the app drew, and
 * `toMatchScreenshot()` compares it with a reference beside the test file.
 *
 *     await expect(screen.getByTestId('card')).toMatchScreenshot('card');
 *
 * The capture is the app's window as the platform composited it (`NgNativeTesting`, this
 * package's native module, `NgNativeTesting`), cropped to a node's frame or a region. The comparison and the
 * references are the pool's, which has the disk: see `screenshot-baselines.ts`.
 */
import { expect } from 'vitest';
import type { FakeFabricNode } from '../test-utils.ts';
import { harness } from './harness.ts';
import { screen, type Frame } from './index.ts';
import type { ScreenshotComparatorOptions, ScreenshotResult } from './screenshot-baselines.ts';
import { testingModuleFrom, type TestingModule } from './testing-module.ts';

export type { ScreenshotComparatorOptions } from './screenshot-baselines.ts';

/**
 * What a screenshot is of: a node, as native laid it out; a region of the window, in points; or
 * `screen`, the whole window.
 */
export type ScreenshotTarget = FakeFabricNode | Frame | typeof screen;

export interface ScreenshotCaptureOptions {
  /**
   * How long to wait for two captures in a row to agree, in milliseconds, so a capture is never
   * taken part way through an animation. Default 5000.
   */
  timeout?: number;
}

export interface ToMatchScreenshotOptions extends ScreenshotCaptureOptions {
  /** This comparison's options, over those the project sets in `deviceTests({ screenshots })`. */
  comparatorOptions?: ScreenshotComparatorOptions;
}

export type { TestingModule } from './testing-module.ts';

/** `NgNativeTesting`, from the Expo modules or, on a desktop host, its TurboModules. */
export function nativeModule(): TestingModule {
  const expoModules = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo
    ?.modules;
  let native: ReactNative | undefined;
  try {
    native = require('react-native') as ReactNative;
  } catch {
    // Node, where there is no app: the error says what is missing.
  }
  return testingModuleFrom({
    expoModules,
    turboModule: native && ((name) => native.TurboModuleRegistry.get(name)),
    os: native?.Platform.OS,
  });
}

type ReactNative = {
  TurboModuleRegistry: { get(name: string): unknown };
  Platform: { OS: string };
};

/**
 * One capture of a target. A node is found by native itself, which places it in the window
 * exactly; a region is in the points `measure()` gives.
 */
function captureOnce(module: TestingModule, target: ScreenshotTarget | undefined) {
  if (!target || target === screen) return module.capture(null);
  if ('reactTag' in target) return module.captureView(target.reactTag);
  return module.capture(target as Frame);
}

/**
 * A PNG, in base64, of a node, a region of the window in points, or the whole window (`screen`, or
 * no target): taken again until two captures in a row agree, so what is moving has settled.
 */
export async function screenshot(
  target?: ScreenshotTarget,
  { timeout = 5000 }: ScreenshotCaptureOptions = {},
): Promise<string> {
  const module = nativeModule();
  const deadline = Date.now() + timeout;
  let last = await captureOnce(module, target);
  for (;;) {
    const next = await captureOnce(module, target);
    if (next === last) return next;
    if (Date.now() > deadline) {
      throw new Error(`The screenshot did not settle within ${timeout}ms: something kept moving.`);
    }
    last = next;
  }
}

/** Screenshots each test took without a name, for the next default name. */
const unnamed = new Map<string, number>();

/** Forget the default names' counts: after each test, so a re-run names its screenshots alike. */
export function resetScreenshotNames(): void {
  unnamed.clear();
}

interface MatcherContext {
  isNot: boolean;
  /** Empty in a device run: the runner's state is set on Vitest's side, not the app's. */
  testPath?: string;
  currentTestName?: string;
  task?: { file?: { filepath?: string } };
}

/** A screenshot's name: the one given, or its test's name and a count. */
function nameOf(test: string | undefined, given: string | undefined): string {
  if (given !== undefined) return given;
  const name = test ?? 'screenshot';
  const count = (unnamed.get(name) ?? 0) + 1;
  unnamed.set(name, count);
  return `${name} ${count}`;
}

/** Whether this run records references: Vitest's `snapshotOptions.updateSnapshot`. */
function updateMode(): string {
  const worker = (
    globalThis as {
      __vitest_worker__?: { config?: { snapshotOptions?: { updateSnapshot?: string } } };
    }
  ).__vitest_worker__;
  return worker?.config?.snapshotOptions?.updateSnapshot ?? 'new';
}

/** Send a capture to the pool, which compares it with its reference or records it. */
async function compare(body: Record<string, unknown>): Promise<ScreenshotResult> {
  const { pool } = harness();
  const response = await fetch(`${pool.url}/screenshot`, {
    method: 'POST',
    body: JSON.stringify({ session: pool.session, update: updateMode(), ...body }),
  });
  const answer = (await response.json()) as { result?: ScreenshotResult; error?: string };
  if (!answer.result) throw new Error(answer.error ?? 'No answer from the pool');
  return answer.result;
}

/** Add `toMatchScreenshot` to `expect`. The device runner does this before every run. */
export function installScreenshotMatcher(): void {
  expect.extend({
    async toMatchScreenshot(
      this: MatcherContext,
      received: ScreenshotTarget | undefined,
      nameOrOptions?: string | ToMatchScreenshotOptions,
      maybeOptions: ToMatchScreenshotOptions = {},
    ) {
      if (this.isNot) throw new Error('toMatchScreenshot cannot be negated with .not.');
      const named = typeof nameOrOptions === 'string';
      const options = named ? maybeOptions : (nameOrOptions ?? maybeOptions);
      const name = nameOf(this.currentTestName, named ? nameOrOptions : undefined);
      const { pass, message, reference } = await compare({
        file: this.task?.file?.filepath ?? this.testPath,
        name,
        png: await screenshot(received, options),
        comparatorOptions: options.comparatorOptions,
      });
      return { pass, message: () => message ?? `The screenshot matches ${reference}` };
    },
  });
}

declare module 'vitest' {
  // Vitest's own type parameters, which an augmentation must repeat exactly.
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    /**
     * Compare a node, a region of the window or `screen` (all of it) with its reference
     * screenshot in `__screenshots__/<test file>/<name>-<platform>.png`, recording the reference
     * when there is none. A pixel differs once a channel moves by more than 1 of 255; see
     * `ToMatchScreenshotOptions`. Await it.
     */
    toMatchScreenshot(name?: string, options?: ToMatchScreenshotOptions): Promise<void>;
    toMatchScreenshot(options?: ToMatchScreenshotOptions): Promise<void>;
  }
}
