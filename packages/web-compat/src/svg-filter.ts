import type { Engine, EngineNode } from '@ng-native/fabric';

/**
 * A drawing's filter, as react-native-svg draws one: a list of steps, each a native view in the
 * filter. A drop shadow is the one step drawn, which is what Highcharts puts under its tooltip.
 * react-native-svg has no drop shadow of its own: it is drawn as a blur of the shape, moved,
 * flooded with the shadow's colour where the blur is, and the shape over it.
 *
 * ponytail: every other step is drawn as an offset of nothing, which passes on what it is given:
 * the native filter stops the app on a child that is no step. Draw one as its native step if a
 * library is seen using it.
 */
export const FILTERED: Readonly<Record<string, string>> = {
  filter: 'RNSVGFilter',
  // The shadow's own node is the first step: the steps after it are the engine's alone.
  feDropShadow: 'RNSVGFeGaussianBlur',
};

/** A step the drawing cannot draw, and the native steps a shadow is drawn with after its blur. */
export const STEP = 'svg:fe-step';
/**
 * What the name of a node the drawing keeps of its own starts with: no script's, and not in the
 * page. The steps after a shadow's blur are such nodes, and the first line of an outline.
 */
export const KEPT = 'svg:kept-';
const STEPS = ['offset', 'flood', 'composite', 'merge'].map((step) => KEPT + step);

/** The view each step is drawn by. */
export const STEP_VIEWS: Readonly<Record<string, string>> = {
  [STEP]: 'RNSVGFeOffset',
  [`${KEPT}offset`]: 'RNSVGFeOffset',
  [`${KEPT}flood`]: 'RNSVGFeFlood',
  [`${KEPT}composite`]: 'RNSVGFeComposite',
  [`${KEPT}merge`]: 'RNSVGFeMerge',
};

/** A filter's region where its attributes say nothing: SVG's, a tenth over each side. */
export const filterProps = (attrs: Readonly<Record<string, string>>): Record<string, unknown> => ({
  x: attrs['x'] ?? '-10%',
  y: attrs['y'] ?? '-10%',
  width: attrs['width'] ?? '120%',
  height: attrs['height'] ?? '120%',
  filterUnits: attrs['filterUnits'] ?? 'objectBoundingBox',
  primitiveUnits: attrs['primitiveUnits'] ?? 'userSpaceOnUse',
});

/** A blur's deviation, `3` or `4 1`, as one for each way. */
function deviations(written: string | undefined): Record<string, number> {
  const [x = 0, y = x] = (written ?? '0')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return { stdDeviationX: x || 0, stdDeviationY: y || 0 };
}

/** The shadow's first step, its blur, as its own node is drawn. */
export const shadowProps = (attrs: Readonly<Record<string, string>>): Record<string, unknown> => ({
  in1: 'SourceAlpha',
  ...deviations(attrs['stdDeviation']),
});

/** The props of the steps after a shadow's blur, in order. */
function laterSteps(attrs: Readonly<Record<string, string>>): Record<string, unknown>[] {
  const opacity = Number(attrs['flood-opacity'] ?? 1);
  return [
    { dx: attrs['dx'] ?? '2', dy: attrs['dy'] ?? '2', result: 'offsetblur' },
    {
      // A colour the engine converts as it does every prop named for one; native reads a number.
      floodColor: attrs['flood-color'] ?? 'black',
      floodOpacity: Number.isFinite(opacity) ? opacity : 1,
    },
    { in2: 'offsetblur', operator1: 'in' },
    { nodes: ['', 'SourceGraphic'] },
  ];
}

/** The steps the engine keeps after each shadow's own node. */
const stepsOf = new WeakMap<EngineNode, EngineNode[]>();

/**
 * Draw a shadow's later steps from its attributes, after it in its filter: made as it is put in
 * one, and set again as its attributes change.
 */
export function shadowDrawn(
  node: EngineNode,
  attrs: Readonly<Record<string, string>>,
  engine: Engine,
): void {
  const filter = node.parent;
  if (node.tag !== 'feDropShadow' || filter?.tag !== 'filter') return;
  let steps = stepsOf.get(node);
  if (!steps) {
    steps = STEPS.map((tag) => engine.createElement(tag));
    stepsOf.set(node, steps);
  }
  const after = filter.childList[filter.childList.indexOf(node) + 1] ?? null;
  for (const step of steps) if (step.parent !== filter) engine.insertBefore(filter, step, after);
  laterSteps(attrs).forEach((props, at) => {
    for (const [key, value] of Object.entries(props)) engine.setProp(steps[at]!, key, value);
  });
}

/** A shadow taken out of its filter takes its later steps with it. */
export function shadowRemoved(node: EngineNode, engine: Engine): void {
  for (const step of stepsOf.get(node) ?? []) engine.removeChild(step.parent, step);
}
