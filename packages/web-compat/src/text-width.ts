import { nativePlatform } from '@ng-native/fabric';
import { HELVETICA, ROBOTO, SYSTEM_FONT, type FontMetrics } from './font-metrics.ts';

/**
 * How wide a text is drawn in the system font, for a library that lays its labels out by what a
 * browser measures: where a label wraps, where it is cut short, whether axis labels are turned.
 * Nothing is drawn while the script asks, so it is worked out from the font's own widths, by
 * size and weight, with its tracking and kerning: within a percent of Chrome's measure.
 * The font is the system font's unless one is asked for: see `fontNamed`.
 */
export function textWidth(
  text: string,
  size: number,
  weight: number | string = 400,
  font: FontMetrics = systemFont(),
): number {
  const read = readOf(font);
  const nearest = nearestWeight(weight, read.weights);
  const widths = font.weights[nearest]!;
  const kerning = nearest >= 600 ? read.boldKerning : read.kerning;
  const track = trackingAt(font, size);
  let width = 0;
  let before = '';
  for (const letter of text) {
    const at = read.index.get(letter);
    const own = at === undefined ? unknownWidth(letter) : widths[at]!;
    // A letter of no width, the space Highcharts breaks a line at, is not tracked either.
    width += own && own + track;
    width += kerning.get(before + letter) ?? 0;
    before = letter;
  }
  return (width / 1000) * size;
}

/** The font a text is drawn in where none other is named: Roboto on Android, else San Francisco. */
export const systemFont = (): FontMetrics =>
  nativePlatform() === 'android' ? ROBOTO : SYSTEM_FONT;

/** A family a font stack is drawn in, and the widths it is measured by. */
export interface NamedFont {
  /** The family the native text is told, or none for the system font. */
  readonly family: string | undefined;
  readonly metrics: FontMetrics;
}

/**
 * Each name in a font stack that is drawn in a font measured here, by the platform: the family
 * native is told, or `null` for the system font. Chrome on a Mac draws `sans-serif` in Helvetica.
 * Android draws every one of these in Roboto.
 */
const FAMILIES: Readonly<Record<string, { ios: string | null; android: null }>> = {
  '-apple-system': { ios: null, android: null },
  'system-ui': { ios: null, android: null },
  blinkmacsystemfont: { ios: null, android: null },
  roboto: { ios: null, android: null },
  'sans-serif': { ios: 'Helvetica', android: null },
  helvetica: { ios: 'Helvetica', android: null },
  arial: { ios: 'Arial', android: null },
};

/**
 * The font a CSS font stack is drawn in: its first name that is one of `FAMILIES`, as a browser
 * draws the first it has. A stack of names none of which is measured is drawn in the system font.
 *
 * ponytail: Roboto on iOS is drawn in the system font, where Chrome has it only as a web font.
 */
export function fontNamed(
  stack: string | undefined,
  platform: 'ios' | 'android' = nativePlatform() === 'android' ? 'android' : 'ios',
): NamedFont {
  const system = platform === 'android' ? ROBOTO : SYSTEM_FONT;
  for (const written of stack?.split(',') ?? []) {
    const name = written
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
      .toLowerCase();
    const known = FAMILIES[name];
    if (!known) continue;
    const family = known[platform] ?? undefined;
    return { family, metrics: family ? HELVETICA : system };
  }
  return { family: undefined, metrics: system };
}

type Weight = keyof FontMetrics['weights'];

/**
 * The weight measured nearest to the one asked for: `bold` is 700, and 900 is drawn as 700 in a
 * font with nothing heavier measured.
 */
function nearestWeight(weight: number | string, measured: readonly Weight[]): Weight {
  const asked =
    weight === 'bold' || weight === 'bolder' ? 700 : Number.parseFloat(String(weight)) || 400;
  return measured.reduce((best, each) =>
    Math.abs(each - asked) < Math.abs(best - asked) ? each : best,
  );
}

/** The tracking a size adds to each letter, between the sizes measured. */
function trackingAt(font: FontMetrics, size: number): number {
  const { sizes, tracking } = font;
  if (size <= sizes[0]!) return tracking[0]!;
  const after = sizes.findIndex((each) => each >= size);
  if (after < 0) return tracking.at(-1)!;
  const [low, high] = [sizes[after - 1]!, sizes[after]!];
  const share = (size - low) / (high - low);
  return tracking[after - 1]! + share * (tracking[after]! - tracking[after - 1]!);
}

/** A letter the table has no width for: an em for a wide one, of CJK, and 0.6 em for others. */
const unknownWidth = (letter: string): number =>
  /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠]/.test(letter) ? 1000 : 600;

interface Read {
  readonly weights: readonly Weight[];
  readonly index: ReadonlyMap<string, number>;
  readonly kerning: ReadonlyMap<string, number>;
  readonly boldKerning: ReadonlyMap<string, number>;
}
const reads = new WeakMap<FontMetrics, Read>();

/** `AT-98 AV-78` as a map from each pair to how much nearer its letters are. */
const pairsOf = (written: string): ReadonlyMap<string, number> =>
  new Map(
    written.split(' ').map((pair): [string, number] => {
      const [first, second] = [...pair];
      return [first! + second!, Number(pair.slice(first!.length + second!.length))];
    }),
  );

/** A font's table as maps, made once. */
function readOf(font: FontMetrics): Read {
  let read = reads.get(font);
  if (!read) {
    const kerning = pairsOf(font.kerning);
    read = {
      weights: Object.keys(font.weights).map(Number) as Weight[],
      index: new Map([...font.chars].map((letter, at) => [letter, at])),
      kerning,
      boldKerning: font.boldKerning === undefined ? kerning : pairsOf(font.boldKerning),
    };
    reads.set(font, read);
  }
  return read;
}
