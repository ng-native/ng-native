/**
 * Grids among Yoga's boxes: Yoga lays out everything it can, and a grid container is a leaf to
 * it, sized by the grid algorithm and filled in afterwards.
 *
 * This is the layout a device would reach by committing, reading sizes back and committing
 * again. Here each of those reads is a Yoga layout of the item on its own.
 */
import { MeasureMode } from 'yoga-layout';
import type { Box, FixtureNode } from './fixture.ts';
import { layOutGrid, type Edges, type GridItem, type Rect } from '@ng-native/fabric';
import { layOut, type Conformance, type Foreign } from './yoga-baseline.ts';

const isGrid = (node: FixtureNode) =>
  node.style['display'] === 'grid' || node.style['display'] === 'inline-grid';
const inFlow = (node: FixtureNode) =>
  node.style['display'] !== 'none' && node.style['position'] !== 'absolute';
const px = (value: string | undefined) => Number.parseFloat(value ?? '') || 0;

/** The properties that place an item in its container, which the grid applies and Yoga must not. */
const PLACING =
  /^(margin-|grid-(row|column|area)|justify-self|align-self|flex-grow|flex-shrink|flex-basis|top|right|bottom|left)/;

/** An item as a box of its own: nothing that places it, and no size that depends on its area. */
function alone(node: FixtureNode, size: Record<string, string> = {}): FixtureNode {
  const style = Object.fromEntries(
    Object.entries(node.style).filter(
      ([property, value]) =>
        !PLACING.test(property) &&
        !(/^(min-|max-)?(width|height)$/.test(property) && value.endsWith('%')),
    ),
  );
  return { ...node, style: { ...style, ...size } };
}

export function layOutWithGrids(
  fixture: FixtureNode,
  conformance: Conformance,
  /** Told of each measurement an item is asked for: a read-back, on a device. */
  onMeasure?: (width: 'min' | 'max' | 'height') => void,
): Box {
  const run = (node: FixtureNode, width?: number) => layOut(node, { conformance, foreign, width });

  const items = (container: FixtureNode): GridItem[] =>
    container.children.filter(inFlow).map((child) => {
      const seen = new Map<string, { width: number; height: number }>();
      return {
        style: child.style,
        measure(width) {
          const key = String(width);
          if (!seen.has(key)) {
            onMeasure?.(typeof width === 'number' ? 'height' : width);
            const box =
              typeof width === 'number'
                ? run(alone(child, { width: `${width}px`, 'box-sizing': 'border-box' }))
                : run(alone(child), width === 'min' ? 0 : undefined);
            seen.set(key, { width: box[2], height: box[3] });
          }
          return seen.get(key)!;
        },
        // Yoga's own baseline: the first box inside, all the way down, or the bottom edge.
        baseline: (width) =>
          baselineOf(run(alone(child, { width: `${width}px`, 'box-sizing': 'border-box' }))),
      };
    });

  /** An item's own boxes at the size its area gave it, moved to where the area is. */
  const placed = (child: FixtureNode, rect: Rect, origin: { left: number; top: number }): Box => {
    const size = {
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      'box-sizing': 'border-box',
    };
    const box = run(
      alone({ ...child, classes: [] }, { ...size, 'min-width': '0', 'min-height': '0' }),
    );
    return [origin.left + rect.left, origin.top + rect.top, rect.width, rect.height, box[4]];
  };

  const foreign: Foreign = {
    measure(node) {
      if (!isGrid(node)) return undefined;
      return (width, widthMode, height, heightMode) => {
        const fixedHeight = heightMode === MeasureMode.Exactly ? height : undefined;
        if (widthMode === MeasureMode.Exactly) {
          const grid = layOutGrid(node.style, items(node), { width, height: fixedHeight });
          return { width, height: grid.height };
        }
        const widest = layOutGrid(node.style, items(node), { height: fixedHeight });
        if (widthMode === MeasureMode.Undefined || widest.width <= width) return widest;
        // Narrower than its content wants: as wide as there is room, or as its tracks must be.
        const fitted = layOutGrid(node.style, items(node), { width, height: fixedHeight });
        return { width: Math.max(width, fitted.usedWidth), height: fitted.height };
      };
    },
    children(node, [, , width, height]) {
      if (!isGrid(node)) return undefined;
      const edge = (side: string) =>
        px(node.style[`padding-${side}`]) + px(node.style[`border-${side}-width`]);
      const origin = { left: edge('left'), top: edge('top') };
      const flow = node.children.filter(inFlow);
      const grid = layOutGrid(node.style, items(node), {
        width: width - origin.left - edge('right'),
        height: height - origin.top - edge('bottom'),
      });
      return node.children.map((child) => {
        const index = flow.indexOf(child);
        if (index >= 0) return placed(child, grid.items[index]!, origin);
        if (child.style['display'] === 'none') return [0, 0, 0, 0, []] as Box;
        return outOfFlow(node, child, grid.area(child.style), [width, height]);
      });
    },
  };

  /**
   * An out-of-flow child: against the grid lines its placement names, and the container's
   * padding edge on a side it names none for. With no inset it sits at the start of that, or
   * where its `-self` says, as Chrome places it.
   */
  const outOfFlow = (
    node: FixtureNode,
    child: FixtureNode,
    at: Edges,
    [width, height]: [number, number],
  ): Box => {
    const border = (side: string) => px(node.style[`border-${side}-width`]);
    const padding = (side: string) => px(node.style[`padding-${side}`]);
    const left =
      at.left === undefined ? border('left') : border('left') + padding('left') + at.left;
    const top = at.top === undefined ? border('top') : border('top') + padding('top') + at.top;
    const right =
      at.right === undefined
        ? width - border('right')
        : border('left') + padding('left') + at.right;
    const bottom =
      at.bottom === undefined
        ? height - border('bottom')
        : border('top') + padding('top') + at.bottom;
    const self = (axis: 'justify' | 'align') => {
      const own = child.style[`${axis}-self`];
      const value = !own || own === 'auto' || own === 'normal' ? node.style[`${axis}-items`] : own;
      return FLEX[(value ?? '').replace(/^(safe|unsafe)\s+/, '')] ?? 'flex-start';
    };
    const frame: FixtureNode = {
      style: {
        width: `${Math.max(right - left, 0)}px`,
        height: `${Math.max(bottom - top, 0)}px`,
        'box-sizing': 'border-box',
        'justify-content': self('align'),
        ...(node.style['direction'] ? { direction: node.style['direction'] } : {}),
      },
      classes: [],
      text: '',
      children: [
        {
          ...child,
          style: {
            ...Object.fromEntries(
              Object.entries(child.style).filter(
                ([property]) => !/^(grid-|justify-self)/.test(property),
              ),
            ),
            'align-self': self('justify'),
          },
        },
      ],
    };
    const [x, y, w, h, inside] = run(frame)[4][0]!;
    return [left + x, top + y, w, h, inside];
  };

  return run(fixture);
}

function baselineOf([, , , height, inside]: Box): number {
  const first = inside[0];
  return first ? first[1] + baselineOf(first) : height;
}

/** Where a `-self` keyword puts a box in a flex container, which is what places one with no inset. */
const FLEX: Record<string, string> = {
  start: 'flex-start',
  'self-start': 'flex-start',
  'flex-start': 'flex-start',
  end: 'flex-end',
  'self-end': 'flex-end',
  'flex-end': 'flex-end',
  center: 'center',
};
