import { domError } from './dom-error.ts';
/**
 * A whole number from what a script passed for one, as `[EnforceRange] long` has it: one that is
 * not a number, or is past what 32 bits hold, throws.
 */
export function whole(value: unknown): number {
  const number = Math.trunc(numberOf(value));
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
  // Private as a browser's are: a script sees only the members the DOM names.
  readonly #pixels: Uint8ClampedArray;
  readonly #wide: number;
  readonly #high: number;
  readonly #space: string;

  /**
   * Of a size, or of pixels, and then the settings, whose colour space is only named: the pixels
   * are read and drawn as sRGB whatever it is.
   */
  constructor(dataOrWidth: unknown, widthOrHeight: unknown, ...rest: unknown[]) {
    if (arguments.length < 2) throw new TypeError('ImageData needs a width and a height.');
    const isData = typeof dataOrWidth === 'object' && dataOrWidth !== null;
    const made = isData
      ? held(dataOrWidth, widthOrHeight, rest[0])
      : blank(dataOrWidth, widthOrHeight);
    this.#pixels = made.pixels;
    this.#wide = made.wide;
    this.#high = made.high;
    this.#space = spaceOf(isData ? rest[1] : rest[0]);
  }

  // Read only, as a browser's are: a script that sets one changes nothing.
  get data(): Uint8ClampedArray {
    return this.#pixels;
  }
  get width(): number {
    return this.#wide;
  }
  get height(): number {
    return this.#high;
  }
  get colorSpace(): string {
    return this.#space;
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

const SPACES = new Set(['srgb', 'display-p3']);

/** The colour space settings name: sRGB where they say none, and one not known throws. */
function spaceOf(settings: unknown): string {
  const named = (settings as { colorSpace?: unknown } | null | undefined)?.colorSpace;
  if (named === undefined) return 'srgb';
  const space = String(named);
  if (!SPACES.has(space)) throw new TypeError(`${space} is not a colour space.`);
  return space;
}

/** Pixels of a size, all transparent black. */
function blank(width: unknown, height: unknown): Made {
  const [wide, high] = [size(width), size(height)];
  if (!wide || !high) {
    throw domError('The source width and height must not be zero.', 'IndexSizeError');
  }
  // As Chrome has it: what is past what 32 bits count is no size, and nothing is made of one.
  if (wide * high * 4 > 0xffffffff) {
    throw domError('The size is past what an ImageData holds.', 'IndexSizeError');
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
  if (!wide || (length / 4) % wide) {
    throw domError('The data is not a whole number of rows.', 'IndexSizeError');
  }
  const high = length / 4 / wide;
  if (height !== undefined && size(height) !== high) {
    throw domError('The data is not as many rows as the height.', 'IndexSizeError');
  }
  return { pixels: data, wide, high };
}

/** A size, as `unsigned long` has one: what is not a number is none, and 32 bits are kept. */
function size(value: unknown): number {
  const number = Math.trunc(numberOf(value));
  return Number.isFinite(number) ? number >>> 0 : 0;
}

/** A number from what a script passed for one, as Web IDL reads one: a BigInt throws. */
function numberOf(value: unknown): number {
  if (typeof value === 'bigint')
    throw new TypeError(`${value}n is not a number a canvas can take.`);
  return Number(value);
}
