import type { Rgba } from './canvas-colour.ts';

/**
 * How what is drawn is laid over the pixels there are: `globalCompositeOperation`. Each is a
 * Porter-Duff operator, or a blend mode laid source-over, as the Compositing and Blending spec
 * has them. Only the pixels read back are laid this way: see `canvas.ts` for what is shown.
 */

/** How much of the source and of what is under it a Porter-Duff operator keeps, by their alphas. */
type Factors = (source: number, under: number) => readonly [number, number];

const OPERATORS: Readonly<Record<string, Factors>> = {
  'source-over': (as) => [1, 1 - as],
  'destination-over': (_, ab) => [1 - ab, 1],
  'source-in': (_, ab) => [ab, 0],
  'destination-in': (as) => [0, as],
  'source-out': (_, ab) => [1 - ab, 0],
  'destination-out': (as) => [0, 1 - as],
  'source-atop': (as, ab) => [ab, 1 - as],
  'destination-atop': (as, ab) => [1 - ab, as],
  xor: (as, ab) => [1 - ab, 1 - as],
  copy: () => [1, 0],
  clear: () => [0, 0],
  lighter: () => [1, 1],
};

/** A blend mode by channel: the colour of one, from 0 to 1, by the source's and what is under. */
type Blend = (source: number, under: number) => number;

const hardLight: Blend = (cs, cb) =>
  cs <= 0.5 ? cb * 2 * cs : cb + (2 * cs - 1) - cb * (2 * cs - 1);

const softLight: Blend = (cs, cb) => {
  if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
  const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
  return cb + (2 * cs - 1) * (d - cb);
};

const BLENDS: Readonly<Record<string, Blend>> = {
  multiply: (cs, cb) => cs * cb,
  screen: (cs, cb) => cs + cb - cs * cb,
  overlay: (cs, cb) => hardLight(cb, cs),
  darken: Math.min,
  lighten: Math.max,
  'color-dodge': (cs, cb) => (cb === 0 ? 0 : cs >= 1 ? 1 : Math.min(1, cb / (1 - cs))),
  'color-burn': (cs, cb) => (cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs)),
  'hard-light': hardLight,
  'soft-light': softLight,
  difference: (cs, cb) => Math.abs(cs - cb),
  exclusion: (cs, cb) => cs + cb - 2 * cs * cb,
};

/**
 * The blend modes that are not by channel. A canvas takes them, and they are laid source-over.
 *
 * ponytail: hue, saturation, color and luminosity mix the channels together; lay them as the
 * spec's `SetLum` and `SetSat` do if a library is seen using one.
 */
const UNMIXED = new Set(['hue', 'saturation', 'color', 'luminosity']);

/** Whether a canvas takes a way of laying for `globalCompositeOperation`. */
export const isComposite = (mode: string): boolean =>
  mode in OPERATORS || mode in BLENDS || UNMIXED.has(mode);

/**
 * The operators that clear what is under the source where there is none: drawn, they change the
 * whole of what they are clipped to, and not only what the shape covers.
 */
const UNBOUNDED = new Set([
  'source-in',
  'destination-in',
  'source-out',
  'destination-atop',
  'copy',
]);

export const isUnbounded = (mode: string): boolean => UNBOUNDED.has(mode);

/**
 * Lay a colour at an alpha over the pixel at `at`, by a way of laying, as much as a clip lets
 * through. The pixels are kept as `ImageData` has them, not premultiplied.
 */
export function laidBy(
  mode: string,
  data: Uint8ClampedArray,
  at: number,
  colour: Rgba | null,
  alpha: number,
  through: number,
): void {
  const as = colour ? alpha : 0;
  const ab = data[at + 3]! / 255;
  const blend = BLENDS[mode];
  const [fa, fb] = (OPERATORS[mode] ?? OPERATORS['source-over']!)(as, ab);
  const lighter = mode === 'lighter';
  let out = as * fa + ab * fb;
  if (lighter) out = Math.min(1, out);
  const kept = through * out + (1 - through) * ab;
  for (let channel = 0; channel < 3; channel++) {
    const cb = data[at + channel]! / 255;
    const cs = colour ? colour[channel]! / 255 : 0;
    const shown = blend ? (1 - ab) * cs + ab * blend(cs, cb) : cs;
    let value = as * fa * shown + ab * fb * cb;
    if (lighter) value = Math.min(1, value);
    const premultiplied = through * value + (1 - through) * ab * cb;
    data[at + channel] = kept > 0 ? (premultiplied / kept) * 255 : 0;
  }
  data[at + 3] = kept * 255;
}
