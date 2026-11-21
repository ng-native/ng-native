/**
 * Visual assertions in a device test, beside `toMatchScreenshot`: what the engine committed to a
 * node (`toHaveStyle`), what native drew at a point of it (`toHaveColorAt`), and where native laid
 * it out (`toHaveSize`, `toBeWithin`).
 */
import { expect } from 'vitest';
import type { FakeFabricNode } from '../test-utils.ts';
import { harness } from './harness.ts';
import { screen, type Frame } from './index.ts';
import { screenshot, type ScreenshotTarget } from './screenshot.ts';
import { inCapture, rgba, sameColour, show, styleMismatches, type Rgba } from './visual-compare.ts';

declare const require: (id: string) => unknown;

function frameOf(node: FakeFabricNode): Frame {
  const frame = harness().recorder.measure(node.reactTag);
  if (!frame) throw new Error('The node has no frame: it is gone, or native has not laid it out.');
  return frame;
}

/** Where a target is in the window, in points: null for the whole window. */
function placeOf(target: ScreenshotTarget): Frame | null {
  if (target === screen) return null;
  return 'reactTag' in target ? frameOf(target as FakeFabricNode) : (target as Frame);
}

/** The colour native drew at each point of a target, in its own points from its top-left. */
export async function colorsAt(
  target: ScreenshotTarget,
  at: readonly { x: number; y: number }[],
): Promise<Rgba[]> {
  const png = await screenshot(target);
  const { pool } = harness();
  // React Native's, on the device: a `require` the package's Node tests never run.
  const { PixelRatio } = require('react-native') as { PixelRatio: { get(): number } };
  const response = await fetch(`${pool.url}/colors`, {
    method: 'POST',
    body: JSON.stringify({
      session: pool.session,
      png,
      // The capture is of the part of the target inside the window.
      points: inCapture(placeOf(target), at),
      scale: PixelRatio.get(),
    }),
  });
  const answer = (await response.json()) as { result?: Rgba[]; error?: string };
  if (!answer.result) throw new Error(answer.error ?? 'No answer from the pool');
  return answer.result;
}

export interface ToHaveColorAtOptions {
  /** How far each channel may be from the colour, of 255. Default 1, as for screenshots. */
  tolerance?: number;
}

export interface SizeOptions {
  /** How far, in points, a side may be from the size asked for. Default 0.5. */
  tolerance?: number;
}

/** Add the visual matchers to `expect`. The device runner does this before every run. */
export function installVisualMatchers(): void {
  expect.extend({
    toHaveStyle(received: FakeFabricNode, expected: Record<string, unknown>) {
      // What the view has now, not what the record a test kept had when it was queried.
      const now = harness().recorder.current(received.reactTag);
      // An error rather than a failed match, so `.not.toHaveStyle` reports it too.
      if (!now) throw new Error('The node is no longer committed: it has gone.');
      const misses = styleMismatches(now as unknown as FakeFabricNode, expected);
      return {
        pass: misses.length === 0,
        message: () =>
          misses.length
            ? `The node's committed style differs:\n  ${misses.join('\n  ')}`
            : `The node's committed style has ${JSON.stringify(expected)}`,
      };
    },
    async toHaveColorAt(
      received: ScreenshotTarget,
      at: { x: number; y: number },
      colour: string,
      { tolerance = 1 }: ToHaveColorAtOptions = {},
    ) {
      const want = rgba(colour);
      if (!want) throw new Error(`Not a colour: ${colour}`);
      const [got] = await colorsAt(received, [at]);
      const pass = sameColour(want, got!, tolerance);
      return {
        pass,
        message: () =>
          `At (${at.x}, ${at.y}) native drew ${show(got!, got)}; expected ${pass ? 'not ' : ''}` +
          `${show(want, colour)}`,
      };
    },
    toHaveSize(
      received: FakeFabricNode,
      size: { width?: number; height?: number },
      { tolerance = 0.5 }: SizeOptions = {},
    ) {
      const frame = frameOf(received);
      const pass =
        (size.width === undefined || Math.abs(frame.width - size.width) <= tolerance) &&
        (size.height === undefined || Math.abs(frame.height - size.height) <= tolerance);
      return {
        pass,
        message: () =>
          `Native laid the node out at ${frame.width} x ${frame.height}; expected ` +
          `${pass ? 'not ' : ''}${size.width ?? 'any'} x ${size.height ?? 'any'}`,
      };
    },
    toBeWithin(
      received: FakeFabricNode,
      other: FakeFabricNode,
      { tolerance = 0.5 }: SizeOptions = {},
    ) {
      const [inner, outer] = [frameOf(received), frameOf(other)];
      const pass =
        inner.x >= outer.x - tolerance &&
        inner.y >= outer.y - tolerance &&
        inner.x + inner.width <= outer.x + outer.width + tolerance &&
        inner.y + inner.height <= outer.y + outer.height + tolerance;
      return {
        pass,
        message: () =>
          `The node, at ${JSON.stringify(inner)}, is ${pass ? '' : 'not '}within ${JSON.stringify(outer)}`,
      };
    },
  });
}

declare module 'vitest' {
  // Vitest's own type parameters, which an augmentation must repeat exactly.
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    /**
     * The props the engine committed to the node: colours compared as RGBA (`'#3366cc'`, `'red'`,
     * `'rgb(...)'`), lengths as points (`16` or `'16px'`), anything else as it is.
     */
    toHaveStyle(expected: Record<string, unknown>): void;
    /** The colour native drew at a point of a node or region, in points from its top-left. Await it. */
    toHaveColorAt(
      at: { x: number; y: number },
      colour: string,
      options?: ToHaveColorAtOptions,
    ): Promise<void>;
    /** Where native laid the node out: its width and height in points, within `tolerance`. */
    toHaveSize(size: { width?: number; height?: number }, options?: SizeOptions): void;
    /** The node's frame inside another's, within `tolerance` points. */
    toBeWithin(other: FakeFabricNode, options?: SizeOptions): void;
  }
}
