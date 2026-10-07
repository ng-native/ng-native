import { parseColor } from './transition.ts';

/**
 * A `background` a token holds as text, where it is no single colour: the gradients a library
 * works out as the app runs and sets as a custom property, a colour slider's track or a colour
 * area's two fades over a colour. A stylesheet's gradient is compiled when the app is built; one
 * set on an element is read here, into what a view's `experimental_backgroundImage` takes.
 *
 * ponytail: `linear-gradient()` with a side or an angle and colour stops at percentages, which
 * is what such a library writes. A corner, a length or two positions on a stop, `radial-` and
 * `repeating-` are not read, and the whole background is then nothing, as an invalid one is.
 * Native has no conic gradient at all.
 */
export interface BackgroundLayers {
  readonly images: readonly object[];
  /** The colour under the images: the last layer, where it is one. */
  readonly color?: string;
}

const SIDES: Readonly<Record<string, number>> = {
  'to top': 0,
  'to right': 90,
  'to bottom': 180,
  'to left': 270,
};

/** Split at the commas that are not inside brackets. */
function split(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(from, at).trim());
      from = at + 1;
    }
  }
  parts.push(text.slice(from).trim());
  return parts;
}

const rgba = (text: string): string | undefined => {
  const parsed = parseColor(text);
  return parsed ? `rgba(${parsed[0]}, ${parsed[1]}, ${parsed[2]}, ${parsed[3]})` : undefined;
};

/** A direction in degrees, or nothing for a first argument that is a colour stop. */
function direction(first: string): number | undefined {
  const side = SIDES[first.toLowerCase()];
  if (side !== undefined) return side;
  const angle = /^(-?[\d.]+)deg$/i.exec(first);
  return angle ? Number(angle[1]) : undefined;
}

/** `rgba(…) 40%` as a stop, or nothing for one this does not read. */
function stop(text: string): { color: string; position: string | null } | undefined {
  const placed = /^(.*\S)\s+(-?[\d.]+%)$/.exec(text);
  const color = rgba(placed ? placed[1]! : text);
  return color === undefined ? undefined : { color, position: placed ? placed[2]! : null };
}

function linear(layer: string): object | undefined {
  const inside = /^linear-gradient\((.*)\)$/is.exec(layer)?.[1];
  if (inside === undefined) return undefined;
  const parts = split(inside);
  const angle = direction(parts[0]!);
  const stops = (angle === undefined ? parts : parts.slice(1)).map(stop);
  if (stops.length < 2 || stops.some((each) => each === undefined)) return undefined;
  return {
    type: 'linear-gradient',
    direction: { type: 'angle', value: angle ?? 180 },
    colorStops: stops,
  };
}

/** The layers a background's text holds, or nothing where any of it is not read. */
export function backgroundLayers(text: string): BackgroundLayers | undefined {
  const layers = split(text.trim());
  const last = layers.at(-1)!;
  const color = parseColor(last) ? last : undefined;
  const images = (color === undefined ? layers : layers.slice(0, -1)).map(linear);
  if (!images.length || images.some((each) => each === undefined)) return undefined;
  return { images: images as object[], color };
}
