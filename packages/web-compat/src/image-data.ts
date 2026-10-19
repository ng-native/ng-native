import { domError } from './dom-error.ts';
/**
 * A whole number from what a script passed for one, as `[EnforceRange] long` has it: one that is
 * not a number, or is past what 32 bits hold, throws.
 */
export function whole(value: unknown): number {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number) || number < -(2 ** 31) || number > 2 ** 31 - 1) {
    throw new TypeError(`${String(value)} is not a whole number a canvas can take.`);
  }
  return number;
}

/**
 * `ImageData`: pixels a script holds, four bytes each, red, green, blue and alpha, not
 * premultiplied. What `getImageData` answers and `putImageData` is given.
 */
export class ImageData {
  private readonly pixels: Uint8ClampedArray;
  private readonly wide: number;
  private readonly high: number;

  constructor(dataOrWidth: unknown, widthOrHeight: unknown, height?: unknown) {
    if (arguments.length < 2) throw new TypeError('ImageData needs a width and a height.');
    const made =
      typeof dataOrWidth === 'object' && dataOrWidth !== null
        ? held(dataOrWidth, widthOrHeight, height)
        : blank(dataOrWidth, widthOrHeight);
    this.pixels = made.pixels;
    this.wide = made.wide;
    this.high = made.high;
  }

  // Read only, as a browser's are: a script that sets one changes nothing.
  get data(): Uint8ClampedArray {
    return this.pixels;
  }
  get width(): number {
    return this.wide;
  }
  get height(): number {
    return this.high;
  }
  get colorSpace(): string {
    return 'srgb';
  }
  get pixelFormat(): string {
    return 'rgba-unorm8';
  }

  get [Symbol.toStringTag](): string {
    return 'ImageData';
  }
}

interface Made {
  readonly pixels: Uint8ClampedArray;
  readonly wide: number;
  readonly high: number;
}

/** Pixels of a size, all transparent black. */
function blank(width: unknown, height: unknown): Made {
  const [wide, high] = [size(width), size(height)];
  if (wide <= 0 || high <= 0) {
    throw domError('The source width and height must not be zero.', 'IndexSizeError');
  }
  return { pixels: new Uint8ClampedArray(wide * high * 4), wide, high };
}

/** Pixels a script has, as rows of a width: as many as there are, or as many as it says. */
function held(data: object, width: unknown, height: unknown): Made {
  if (!(data instanceof Uint8ClampedArray)) {
    throw new TypeError('The data of an ImageData is a Uint8ClampedArray.');
  }
  const wide = size(width);
  const { length } = data;
  if (!length || length % 4) {
    throw domError('The data is not a whole number of pixels.', 'InvalidStateError');
  }
  if (wide <= 0 || (length / 4) % wide) {
    throw domError('The data is not a whole number of rows.', 'IndexSizeError');
  }
  const high = length / 4 / wide;
  if (height !== undefined && size(height) !== high) {
    throw domError('The data is not as many rows as the height.', 'IndexSizeError');
  }
  return { pixels: data, wide, high };
}

/** A size, as `unsigned long` has one: what is not a number is none. */
function size(value: unknown): number {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? number : 0;
}
