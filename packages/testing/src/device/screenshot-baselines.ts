/**
 * The pool's half of `toMatchScreenshot()`: where a screenshot's reference lives, recording one,
 * and comparing a capture with it. The app sends the PNG it captured; the disk is here.
 *
 * Comparison is Vitest browser mode's: `@blazediff/core`, a pixelmatch, with its option names. The
 * default is close to exact, where Vitest's allows a small difference: a pixel counts as changed
 * once a channel moves by more than 1 of 255. An iOS simulator draws the odd edge pixel a step
 * apart from one run to the next; anything a person could see is a change.
 */
import { diff } from '@blazediff/core';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

export interface ScreenshotComparatorOptions {
  /**
   * How far a pixel's colour may move before it counts as different, from 0 to 1, as pixelmatch
   * reads it. Default 0: any change counts.
   */
  threshold?: number;
  /** How many pixels may differ. Default 0. */
  allowedMismatchedPixels?: number;
  /** The share of the image, from 0 to 1, that may differ. Default 0. */
  allowedMismatchedPixelRatio?: number;
  /** Whether pixels pixelmatch takes for anti-aliasing count as different. Default true. */
  includeAA?: boolean;
  /**
   * How far each of a pixel's channels may move, of 255, before the pixel is compared at all.
   * Default 1, the step a simulator's rasteriser varies by between runs; 0 is an exact match.
   */
  channelTolerance?: number;
}

export interface ScreenshotOptions {
  /** The comparison every `toMatchScreenshot()` in the project uses, unless a call says otherwise. */
  comparatorOptions?: ScreenshotComparatorOptions;
}

export interface ScreenshotRequest {
  /** The test file the screenshot was taken in. */
  file: string;
  /** The screenshot's name in that file. */
  name: string;
  platform: string;
  /** The capture, a PNG in base64. */
  png: string;
  /** Vitest's `snapshotOptions.updateSnapshot`: record a missing reference, every one, or none. */
  update: 'all' | 'new' | 'none';
  comparatorOptions?: ScreenshotComparatorOptions;
}

export interface ScreenshotResult {
  pass: boolean;
  message?: string;
  /** The reference's path. */
  reference: string;
}

/** `__screenshots__/<test file>/<name>-<platform>.png`, beside the test file. */
export function screenshotPath(file: string, name: string, platform: string): string {
  return path.join(
    path.dirname(file),
    '__screenshots__',
    path.basename(file),
    `${safeName(name)}-${platform}.png`,
  );
}

/** A name as a file name: no directories, nothing hidden. */
function safeName(name: string): string {
  return name.replace(/[^\w .-]+/g, '-').replace(/^[.\s]+/, '') || 'screenshot';
}

export function matchScreenshot(
  request: ScreenshotRequest,
  defaults: ScreenshotComparatorOptions = {},
): ScreenshotResult {
  const reference = screenshotPath(request.file, request.name, request.platform);
  const actualPath = reference.replace(/\.png$/, '-actual.png');
  const diffPath = reference.replace(/\.png$/, '-diff.png');
  const actual = Buffer.from(request.png, 'base64');
  // What an earlier failure left goes once the screenshot matches again, or is recorded anew.
  const clear = () => {
    rmSync(actualPath, { force: true });
    rmSync(diffPath, { force: true });
  };
  const exists = existsSync(reference);

  if (!exists && request.update === 'none') {
    writeFileSync(mkdirFor(actualPath), actual);
    rmSync(diffPath, { force: true });
    return {
      pass: false,
      reference,
      message:
        `No reference screenshot at ${reference}, and this run records none (as on CI). ` +
        `The capture is at ${actualPath}; run without CI, or with -u, to record it.`,
    };
  }
  if (!exists || request.update === 'all') {
    writeFileSync(mkdirFor(reference), actual);
    clear();
    return { pass: true, reference };
  }

  const expected = PNG.sync.read(readFileSync(reference));
  const received = PNG.sync.read(actual);
  if (expected.width !== received.width || expected.height !== received.height) {
    writeFileSync(actualPath, actual);
    rmSync(diffPath, { force: true });
    return {
      pass: false,
      reference,
      message:
        `The screenshot is ${received.width}x${received.height}px, and its reference ` +
        `${expected.width}x${expected.height}px. Reference: ${reference}, capture: ${actualPath}.`,
    };
  }

  const options = {
    threshold: 0,
    includeAA: true,
    channelTolerance: 1,
    ...defaults,
    ...request.comparatorOptions,
  };
  withinTolerance(expected.data, received.data, options.channelTolerance);
  const output = new PNG({ width: expected.width, height: expected.height });
  const mismatched = diff(
    expected.data,
    received.data,
    output.data,
    expected.width,
    expected.height,
    {
      threshold: options.threshold,
      includeAA: options.includeAA,
    },
  );
  const area = expected.width * expected.height;
  const allowed = Math.min(
    options.allowedMismatchedPixels ?? Number.POSITIVE_INFINITY,
    (options.allowedMismatchedPixelRatio ?? Number.POSITIVE_INFINITY) * area,
  );
  if (mismatched <= (allowed === Number.POSITIVE_INFINITY ? 0 : allowed)) {
    clear();
    return { pass: true, reference };
  }
  writeFileSync(actualPath, actual);
  writeFileSync(diffPath, PNG.sync.write(output));
  return {
    pass: false,
    reference,
    message:
      `${mismatched} of ${area} pixels (${((mismatched / area) * 100).toFixed(2)}%) differ from ` +
      `${reference}. Capture: ${actualPath}, difference: ${diffPath}.`,
  };
}

function mkdirFor(file: string): string {
  mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

/** Give each received pixel within `tolerance` of the expected one, on every channel, its value. */
function withinTolerance(expected: Uint8Array, received: Uint8Array, tolerance: number): void {
  if (tolerance <= 0) return;
  for (let i = 0; i < expected.length; i += 4) {
    let close = true;
    for (let channel = 0; channel < 4 && close; channel++) {
      close = Math.abs(expected[i + channel]! - received[i + channel]!) <= tolerance;
    }
    if (close) received.set(expected.subarray(i, i + 4), i);
  }
}
