/**
 * A fake Fabric that lays out what it is given, so the engine can read boxes back from it the
 * way it reads them from a device: `getBoundingClientRect` on a committed node, straight after
 * the commit. Yoga lays the tree out as React Native's does, and a paragraph is as wide as its
 * text at ten points a character, wrapping at spaces and breaking at line breaks, twenty points a
 * line.
 */
import type { FabricNode, FabricUIManager } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { layOutRects, type Box } from './layout.ts';

/** A Fabric that answers where a committed node is, as React Native's does. */
type ReadsBack = FabricUIManager & {
  getBoundingClientRect?: (
    handle: FabricNode,
  ) => readonly [number, number, number, number] | undefined;
};

export const SCREEN = { width: 400, height: 800 };
const GLYPH = 10;
const LINE = 20;

const textOf = (node: FakeFabricNode): string =>
  node.children.map((child) => String(child.props['text'] ?? '') + textOf(child)).join('');

export function paragraph(node: FakeFabricNode) {
  if (node.viewName !== 'Paragraph') return undefined;
  // A line break in the text is a line break, and each line wraps at its spaces.
  const lines = textOf(node)
    .split('\n')
    .map((line) => line.split(' '));
  return (width: number | undefined) => {
    let count = 0;
    let widest = 0;
    for (const words of lines) {
      count += 1;
      let line = 0;
      for (const word of words) {
        const size = word.length * GLYPH;
        if (line > 0 && line + GLYPH + size > (width ?? Infinity)) {
          count += 1;
          line = 0;
        }
        line += (line > 0 ? GLYPH : 0) + size;
        widest = Math.max(widest, line);
      }
    }
    return { width: widest, height: count * LINE };
  };
}

export interface LaidOutFabric extends FakeFabric {
  /** Where the view with this `nativeID` is on the screen, as last committed. */
  box(nativeID: string): { left: number; top: number; width: number; height: number };
}

export function createLaidOutFabric(conformance: 'classic' | 'strict' = 'classic'): LaidOutFabric {
  return layOutFabric(createFakeFabric(), { conformance });
}

/**
 * Have a fake Fabric lay out what it is given, in a screen of a size: what `createLaidOutFabric`
 * answers, for a fabric made elsewhere. Each committed tree is laid out once, however many boxes
 * are read from it. `measureInWindow` answers the same box where `measure` says so, as a device
 * does for a view with no transform, and what a scroll view holds is moved by as far as a
 * `scrollTo` sent it asks where `scrolls` says so.
 */
export function layOutFabric(
  fabric: FakeFabric,
  options: {
    conformance?: 'classic' | 'strict';
    screen?: { width: number; height: number };
    measure?: boolean;
    scrolls?: boolean;
  } = {},
): LaidOutFabric {
  const laidOut = fabric as LaidOutFabric;
  const { conformance = 'classic', screen = SCREEN } = options;
  let laidFrom: readonly FakeFabricNode[] | undefined;
  let laidIn = '';
  let laid: ReturnType<typeof layOutRects<FakeFabricNode>> | undefined;
  /** How far each scroll view has been told to scroll, by tag. */
  const scrolled = new Map<number, { x: number; y: number }>();
  // A commit hands over a new tree, so the one laid out is kept only as long as it is committed,
  // in a screen of the same size, and until a scroll view is scrolled.
  const boxes = () => {
    const size = `${screen.width}x${screen.height}`;
    if (laidFrom !== fabric.committed || laidIn !== size || !laid) {
      laidFrom = fabric.committed;
      laidIn = size;
      laid = layOutRects(fabric.committed, screen, paragraph, conformance);
      if (scrolled.size) for (const node of fabric.committed) shift(laid, node, 0, 0);
    }
    return laid;
  };
  const shift = (all: Map<FakeFabricNode, Box>, node: FakeFabricNode, x: number, y: number) => {
    const box = all.get(node);
    if (box && (x || y)) all.set(node, { ...box, left: box.left - x, top: box.top - y });
    const by = scrolled.get(node.reactTag);
    for (const child of node.children) shift(all, child, x + (by?.x ?? 0), y + (by?.y ?? 0));
  };
  if (options.scrolls) {
    const send = fabric.dispatchCommand?.bind(fabric);
    fabric.dispatchCommand = (handle, name, args) => {
      send?.(handle, name, args);
      const { reactTag, viewName } = handle as unknown as FakeFabricNode;
      if (name !== 'scrollTo' || viewName !== 'ScrollView') return;
      scrolled.set(reactTag, { x: Number(args[0]) || 0, y: Number(args[1]) || 0 });
      laid = undefined;
    };
  }
  const withTag = (tag: number) => (node: FakeFabricNode) => node.reactTag === tag;
  const find = (
    all: readonly FakeFabricNode[],
    test: (node: FakeFabricNode) => boolean,
  ): FakeFabricNode | undefined => {
    for (const each of all) {
      const found = test(each) ? each : find(each.children, test);
      if (found) return found;
    }
    return undefined;
  };
  const rect = (handle: FabricNode) => {
    // The newest clone of the node, as Fabric answers for: the handle may be an older one.
    const node = find(fabric.committed, withTag((handle as unknown as FakeFabricNode).reactTag));
    const box = node && boxes().get(node);
    return box ? ([box.left, box.top, box.width, box.height] as const) : undefined;
  };
  (laidOut as ReadsBack).getBoundingClientRect = rect;
  if (options.measure) {
    (laidOut as FabricUIManager).measureInWindow = (handle, onSuccess) => {
      const box = rect(handle);
      if (box) onSuccess(...box);
    };
  }
  laidOut.box = (nativeID) => {
    const node = find(fabric.committed, (each) => each.props['nativeID'] === nativeID);
    if (!node) throw new Error(`no committed view ${nativeID}`);
    return boxes().get(node)!;
  };
  return laidOut;
}
