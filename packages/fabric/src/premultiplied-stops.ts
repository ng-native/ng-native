/**
 * A gradient's stops, with each one at no opacity given the colour of the stop it fades to or from.
 *
 * CSS interpolates stops in premultiplied alpha, where a stop at no opacity adds no colour of its
 * own: `transparent` to white is white throughout. iOS interpolates the channels as they stand,
 * and halfway from `rgb(0 0 0 / 0)` to white is grey at half opacity. With its neighbour's
 * channels the stop paints the same either way. One between two colours becomes two stops at one
 * position, the first fading from the colour before and the second to the colour after.
 *
 * A stop at part opacity adds its colour in proportion, so between two stops of different colour
 * and opacity the colour bends towards the more opaque one. Stops written along that curve stand
 * in for it.
 */
import { parseColor } from './transition.ts';

/** One stop of a gradient as native takes it. */
interface GradientStop {
  readonly color?: unknown;
  readonly position?: unknown;
}

const BLACK = '0, 0, 0';

export function premultipliedStops(stops: readonly GradientStop[]): GradientStop[] {
  const colours = stops.map((stop) => {
    const parsed = parseColor(stop.color);
    return parsed && { channels: parsed.slice(0, 3).join(', '), clear: parsed[3] === 0 };
  });
  const visible = (i: number) => (colours[i]?.clear === false ? colours[i].channels : undefined);

  const out: GradientStop[] = [];
  // The colour React Native's iOS painter gives a transparent black stop: the last stop that was
  // not one. Right when that is the colour wanted, and otherwise avoided by a stop a shade off
  // black, which at no opacity paints the same.
  let lent: string | undefined;
  const fading = (stop: GradientStop, channels: string) => {
    const written = channels === BLACK && lent && lent !== BLACK ? '0, 0, 1' : channels;
    if (written !== BLACK) lent = written;
    out.push({ ...stop, color: `rgba(${written}, 0)` });
  };

  stops.forEach((stop, i) => {
    const colour = colours[i];
    const lenders = colour?.clear ? [...new Set([visible(i - 1), visible(i + 1)])] : [];
    const [first, second] = lenders.filter((channels) => channels !== undefined);
    if (!first) {
      const own = colour?.channels ?? 'unknown';
      if (!colour?.clear || own !== BLACK) lent = own;
      out.push(stop);
      return;
    }
    const position = second ? (stop.position ?? impliedPosition(stops, i)) : undefined;
    if (position === undefined) return fading(stop, first);
    fading({ ...stop, position }, first);
    fading({ ...stop, position }, second!);
  });
  return curved(out);
}

/**
 * How many stops stand in for the curve between two. They sit where the opacity has changed by
 * equal ratios, which is where the curve bends evenly, and at 8 native's straight lines between
 * them stay within a level of it from 2% opacity to full.
 */
const STEPS = 8;

/** The stops, with those along the curve between two of different colour and opacity written in. */
function curved(stops: readonly GradientStop[]): GradientStop[] {
  const spans = stops.map((_, i) => span(stops, i));
  return stops.flatMap((stop, i) => {
    const [before, after] = [spans[i - 1], spans[i]];
    // A stop beside a curve is placed too: native would space an unplaced one between the stops
    // written in around it.
    const position = after?.start ?? before?.end ?? stop.position;
    return [{ ...stop, position }, ...(after ? along(after) : [])];
  });
}

interface Span {
  readonly from: readonly number[];
  readonly to: readonly number[];
  readonly start: string | number;
  readonly end: string | number;
}

/** The run from stop `i` to the next, when its colour bends and both ends can be placed. */
function span(stops: readonly GradientStop[], i: number): Span | undefined {
  const from = parseColor(stops[i]!.color);
  const to = parseColor(stops[i + 1]?.color);
  if (!from || !to || !bends(from, to)) return undefined;
  const start = stops[i]!.position ?? impliedPosition(stops, i);
  const end = stops[i + 1]!.position ?? impliedPosition(stops, i + 1);
  // Two stops at one position are a hard edge, with no run between them to curve.
  if (unit(start) === undefined || unit(start) !== unit(end) || start === end) return undefined;
  return { from, to, start: start as string | number, end: end as string | number };
}

/** Whether the colour between two bends: both have some opacity, and differ in it and in colour. */
function bends(from: readonly number[], to: readonly number[]): boolean {
  if (!from[3] || !to[3] || from[3] === to[3]) return false;
  return from.slice(0, 3).join() !== to.slice(0, 3).join();
}

/** The stops along a span's curve, each the colour CSS paints at its position. */
function along({ from, to, start, end }: Span): GradientStop[] {
  const [a, b] = [parseFloat(String(start)), parseFloat(String(end))];
  return Array.from({ length: STEPS - 1 }, (_, k) => {
    const alpha = from[3]! * (to[3]! / from[3]!) ** ((k + 1) / STEPS);
    const t = (alpha - from[3]!) / (to[3]! - from[3]!);
    const channel = (c: number) =>
      Math.round((from[c]! * from[3]! * (1 - t) + to[c]! * to[3]! * t) / alpha);
    const at = Math.round((a + (b - a) * t) * 1e4) / 1e4;
    return {
      color: `rgba(${channel(0)}, ${channel(1)}, ${channel(2)}, ${Math.round(alpha * 1000) / 1000})`,
      position: unit(start) ? `${at}%` : at,
    };
  });
}

/**
 * Where CSS puts a stop written without a position: spaced evenly between the placed stops either
 * side of it, the first stop at 0% and the last at 100%.
 */
function impliedPosition(stops: readonly GradientStop[], i: number): string | number | undefined {
  let from = i;
  while (from > 0 && stops[from]!.position == null) from--;
  let to = i;
  while (to < stops.length - 1 && stops[to]!.position == null) to++;
  const end = stops[to]!.position ?? '100%';
  // The first stop is at the start of the line, in whichever unit the stop after it is placed.
  const start = stops[from]!.position ?? (typeof end === 'number' ? 0 : '0%');
  // ponytail: a percentage and a length either side need the box's size, which only native has, so
  // the stop stays one stop in the colour before it. Positions written out of order are not
  // clamped as CSS clamps them either. Resolve both in points if a design needs one.
  if (unit(start) === undefined || unit(start) !== unit(end)) return undefined;
  const [a, b] = [parseFloat(String(start)), parseFloat(String(end))];
  const at = Math.round((a + ((b - a) * (i - from)) / (to - from)) * 1e4) / 1e4;
  return unit(start) ? `${at}%` : at;
}

/** What a position is measured in: `%`, nothing for points, or undefined for neither. */
function unit(position: unknown): string | undefined {
  if (typeof position === 'number') return '';
  return typeof position === 'string' && position.endsWith('%') ? '%' : undefined;
}
