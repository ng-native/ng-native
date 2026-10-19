import { canvasColour } from './canvas-colour.ts';

/** What a channel of eight bits rounds to nothing at: a paint fainter than this is not seen. */
const FAINTEST = 1 / 510;

/** How solid a paint is as written, with its own opacity: nothing for `none`. */
function solidity(paint: string, opacity: string | undefined): number {
  if (paint.trim() === 'none') return 0;
  const colour = canvasColour(paint);
  if (!colour) return 1;
  const own = opacity === undefined ? 1 : Number.parseFloat(opacity);
  return colour[3] * (Number.isFinite(own) ? own : 1);
}

/**
 * Whether a shape is painted too faintly to see, by its fill and its stroke both written on it:
 * a paint left unwritten may be its group's. Such a shape is drawn with no opacity, which
 * react-native-svg skips drawing and still hit tests.
 *
 * Highcharts lays a wide, all but transparent line over each series to take touches near it.
 * react-native-svg clips to the outline of every stroke it draws, which for a line of thousands of
 * points crossing itself is minutes of the main thread, each time the drawing changes.
 */
export function isUnseen(attrs: Readonly<Record<string, string>>): boolean {
  const { fill, stroke } = attrs;
  if (fill === undefined || stroke === undefined) return false;
  return (
    solidity(fill, attrs['fill-opacity']) < FAINTEST &&
    solidity(stroke, attrs['stroke-opacity']) < FAINTEST
  );
}
