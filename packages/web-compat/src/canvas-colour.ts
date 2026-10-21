import { parseColor } from '@ng-native/fabric';

/**
 * A colour as a canvas takes one for a style: what CSS writes as a hex, a name, `rgb()` or
 * `hsl()`, in the old form with commas or the new one with spaces and a slash. A style given
 * what is not one is no change, as a browser has it, so this is strict where `parseColor` in
 * `@ng-native/fabric` is lenient.
 */

/** Red, green and blue from 0 to 255, and alpha from 0 to 1. */
export type Rgba = [number, number, number, number];

const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/;
const PERCENT = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)%$/;
const ANGLE = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)$/;
const HEX = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/;
const FUNCTION = /^(rgba?|hsla?)\(([^()]*?)\)?$/;
/** Colours written in a way this does not work out, which a browser takes: kept as they are. */
const OTHER =
  /^(?:(?:lab|lch|oklab|oklch|hwb|color|color-mix|light-dark)\(.*|(?:rgba?|hsla?)\(\s*from\s[^)]*)\)$/;

const TURNS: Readonly<Record<string, number>> = {
  deg: 1,
  rad: 180 / Math.PI,
  grad: 0.9,
  turn: 360,
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** A number, a percentage of `whole`, or `none` where the form allows it, else null. */
function amount(token: string, whole: number, kinds: string): number | null {
  if (kinds.includes('n') && NUMBER.test(token)) return Number(token);
  const percent = kinds.includes('%') ? PERCENT.exec(token) : null;
  if (percent) return (Number(percent[1]) / 100) * whole;
  return kinds.includes('x') && token === 'none' ? 0 : null;
}

function hueOf(token: string, modern: boolean): number | null {
  if (NUMBER.test(token)) return Number(token);
  const angle = ANGLE.exec(token);
  if (angle) return Number(angle[1]) * TURNS[angle[2]!]!;
  return modern && token === 'none' ? 0 : null;
}

function alphaOf(token: string | undefined, modern: boolean): number | null {
  if (token === undefined) return 1;
  const alpha = amount(token, 1, modern ? 'n%x' : 'n%');
  return alpha === null ? null : clamp(alpha, 0, 1);
}

/** The parts of a function's body: three and an alpha, by commas or by spaces and a slash. */
function partsOf(body: string): { parts: string[]; alpha?: string; modern: boolean } | null {
  if (body.includes(',')) {
    if (body.includes('/')) return null;
    const parts = body.split(',').map((part) => part.trim());
    if (parts.some((part) => !part) || (parts.length !== 3 && parts.length !== 4)) return null;
    return { parts: parts.slice(0, 3), alpha: parts[3], modern: false };
  }
  const [main, alpha, extra] = body.split('/');
  if (extra !== undefined || (alpha !== undefined && !alpha.trim())) return null;
  const parts = main!.trim().split(/\s+/);
  return parts.length === 3 ? { parts, alpha: alpha?.trim(), modern: true } : null;
}

function rgbOf(parts: string[], modern: boolean): number[] | null {
  // In the old form, all three are numbers or all three are percentages.
  const kinds = modern ? ['n%x'] : ['n', '%'];
  for (const kind of kinds) {
    const channels = parts.map((part) => amount(part, 255, kind));
    if (channels.every((channel) => channel !== null)) {
      return channels.map((channel) => Math.round(clamp(channel!, 0, 255)));
    }
  }
  return null;
}

function hslOf(parts: string[], modern: boolean): number[] | null {
  const hue = hueOf(parts[0]!, modern);
  const [saturation, lightness] = parts
    .slice(1)
    .map((part) => amount(part, 1, modern ? 'n%x' : '%'));
  if (hue === null || saturation == null || lightness == null) return null;
  // In the new form a number is a percentage too.
  const [s, l] = [saturation, lightness].map((part, at) =>
    clamp(modern && NUMBER.test(parts[at + 1]!) ? part / 100 : part, 0, 1),
  ) as [number, number];
  const h = (((hue % 360) + 360) % 360) / 30;
  const reach = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h) % 12;
    return Math.round((l - reach * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  return [channel(0), channel(8), channel(4)];
}

function functionColour(name: string, body: string): Rgba | null {
  const found = partsOf(body);
  if (!found) return null;
  const channels = name.startsWith('rgb')
    ? rgbOf(found.parts, found.modern)
    : hslOf(found.parts, found.modern);
  const alpha = alphaOf(found.alpha, found.modern);
  return channels && alpha !== null ? ([...channels, alpha] as Rgba) : null;
}

/** A colour a canvas takes for a style, or null for what is not one it knows. */
export function canvasColour(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  if (HEX.test(text)) return parseColor(text);
  if (/^[a-z]+$/.test(text)) return text === 'currentcolor' ? [0, 0, 0, 1] : parseColor(text);
  const called = FUNCTION.exec(text);
  return called ? functionColour(called[1]!, called[2]!) : null;
}

/** Whether each colour a style was set to is one, kept: a chart sets the same few each frame. */
const known = new Map<string, boolean>();

/**
 * What a style is kept as, for one given as a colour: the words given, where they are a colour
 * this knows or one written in a way it does not work out. Undefined for what is no colour.
 */
export function acceptedColour(value: string): string | undefined {
  let accepted = known.get(value);
  if (accepted === undefined) {
    accepted = canvasColour(value) !== null || OTHER.test(value.trim().toLowerCase());
    // Forgotten all at once past a few hundred, so a script that makes colours cannot fill it.
    if (known.size >= 512) known.clear();
    known.set(value, accepted);
  }
  return accepted ? value : undefined;
}

/** A colour as a style reads back: `#rrggbb` where it is solid, and `rgba()` where it is not. */
export function serializedColour(value: string): string {
  const colour = canvasColour(value);
  if (!colour) return value;
  const [r, g, b, a] = colour;
  if (a >= 1)
    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  return `rgba(${r}, ${g}, ${b}, ${alphaText(a)})`;
}

/** An alpha in as few places as say the same byte of it: a half is 0.5, and not 0.50196. */
export function alphaText(a: number): number {
  const byte = Math.round(a * 255);
  const short = Math.round((byte / 255) * 100) / 100;
  return Math.round(short * 255) === byte ? short : Math.round((byte / 255) * 1000) / 1000;
}
