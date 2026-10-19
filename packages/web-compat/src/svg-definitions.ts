import { viewBoxProps } from '@ng-native/icons';

/**
 * What a drawing defines for its shapes to use, beside its gradients and clips: a marker drawn at
 * the ends and corners of a line, an arrow head, and a pattern a shape is filled with as a tile.
 * Each is a react-native-svg definition, found by its name as a shape is drawn.
 */
export const DEFINED: Readonly<Record<string, string>> = {
  marker: 'RNSVGMarker',
  pattern: 'RNSVGPattern',
};

/** A shape's references to the markers at its start, its corners and its end. */
export const MARKED: Readonly<Record<string, string>> = {
  'marker-start': 'markerStart',
  'marker-mid': 'markerMid',
  'marker-end': 'markerEnd',
};

/** How a pattern's tile and what is in it are measured: by the shape filled, or the drawing. */
const UNITS: Readonly<Record<string, number>> = { objectBoundingBox: 0, userSpaceOnUse: 1 };

/** A marker's props, with SVG's defaults where its attributes say nothing. */
const markerProps = (attrs: Readonly<Record<string, string>>): Record<string, unknown> => ({
  refX: attrs['refX'] ?? '0',
  refY: attrs['refY'] ?? '0',
  markerWidth: attrs['markerWidth'] ?? '3',
  markerHeight: attrs['markerHeight'] ?? '3',
  markerUnits: attrs['markerUnits'] ?? 'strokeWidth',
  orient: attrs['orient'] ?? '0',
  ...viewBoxProps(attrs['viewBox']),
});

/** A pattern's props, with SVG's defaults where its attributes say nothing. */
const patternProps = (attrs: Readonly<Record<string, string>>): Record<string, unknown> => ({
  x: attrs['x'] ?? '0',
  y: attrs['y'] ?? '0',
  width: attrs['width'] ?? '0',
  height: attrs['height'] ?? '0',
  patternUnits: UNITS[attrs['patternUnits'] ?? ''] ?? 0,
  patternContentUnits: UNITS[attrs['patternContentUnits'] ?? ''] ?? 1,
  ...viewBoxProps(attrs['viewBox']),
});

/** The props of a marker or a pattern, from its attributes. */
export function definitionProps(
  name: string,
  attrs: Readonly<Record<string, string>>,
): Record<string, unknown> {
  if (name === 'marker') return markerProps(attrs);
  return name === 'pattern' ? patternProps(attrs) : {};
}
