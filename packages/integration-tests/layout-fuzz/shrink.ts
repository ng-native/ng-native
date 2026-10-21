/**
 * Shrinking a failing case to a small one that still fails: take away a box, lift a box's
 * children into its place, take away a declaration or some text, round a length, and keep each
 * step that still fails, until no step does. Every candidate one step smaller is laid out in one
 * batch, and the first that still fails is taken.
 */
import type { Case, CaseNode, Declaration } from './case.ts';

/** Every case one step smaller than this one, the biggest steps first. */
export function smaller(test: Case): Case[] {
  const out: CaseNode[] = [];
  const root = test.root;
  // Each box taken away, and each box replaced by what is in it.
  const edits = (node: CaseNode, replace: (next: CaseNode[]) => CaseNode): void => {
    node.children.forEach((child, i) => {
      const without = node.children.filter((_, j) => j !== i);
      out.push(replace([{ ...node, children: without }]));
      if (child.children.length) {
        const lifted = [
          ...node.children.slice(0, i),
          ...child.children,
          ...node.children.slice(i + 1),
        ];
        out.push(replace([{ ...node, children: lifted }]));
      }
      edits(child, (next) =>
        replace([{ ...node, children: node.children.map((c, j) => (j === i ? next[0]! : c)) }]),
      );
    });
  };
  edits(root, (next) => next[0]!);
  // Each declaration taken away or made simpler, and each text shortened.
  const own = (node: CaseNode, replace: (next: CaseNode) => CaseNode): void => {
    node.declarations.forEach((declaration, i) => {
      out.push(replace({ ...node, declarations: node.declarations.filter((_, j) => j !== i) }));
      for (const simpler of simplify(declaration)) {
        out.push(
          replace({
            ...node,
            declarations: node.declarations.map((d, j) => (j === i ? simpler : d)),
          }),
        );
      }
    });
    if (node.text !== undefined) {
      const { text: _, ...rest } = node;
      out.push(replace(rest));
      const words = node.text.split(' ');
      if (words.length > 1) out.push(replace({ ...node, text: words.slice(1).join(' ') }));
      if (words[0]!.length > 1)
        out.push(replace({ ...node, text: [words[0]!.slice(1), ...words.slice(1)].join(' ') }));
    }
    node.children.forEach((child, i) =>
      own(child, (next) =>
        replace({ ...node, children: node.children.map((c, j) => (j === i ? next : c)) }),
      ),
    );
  };
  own(root, (next) => next);
  return out.map((next) => ({ seed: test.seed, root: next }));
}

/** Rounder lengths than `n` pixels: to tens, then to 50 or 100. */
function rounder(n: number): number[] {
  const round = Math.round(n / 10) * 10;
  if (round !== n) return round === 0 ? [] : [round];
  return n > 10 && n !== 50 && n !== 100 ? [n > 50 ? 100 : 50] : [];
}

/** A value made rounder: lengths to tens, percentages to a half, track lists shorter. */
function simplify([property, value]: Declaration): Declaration[] {
  const px = /^(-?)(\d+)px$/.exec(value);
  if (px) return rounder(Number(px[2])).map((n) => [property, `${px[1]}${n}px`]);
  if (/^\d+%$/.test(value)) return value === '50%' || value === '100%' ? [] : [[property, '50%']];
  if (/^minmax\(/.test(value)) return [[property, '1fr']];
  // A track list, one track shorter from either end; a `minmax()` is one track.
  const tracks = value.match(/minmax\([^)]*\)|\S+/g) ?? [];
  if (!property.startsWith('grid-template') || tracks.length < 2) return [];
  return [
    [property, tracks.slice(1).join(' ')],
    [property, tracks.slice(0, -1).join(' ')],
  ];
}

/** How big a case is, to keep the smallest reproducer of a class. */
export function weight(test: Case): number {
  const visit = (node: CaseNode): number =>
    1 +
    node.declarations.length +
    (node.text?.length ?? 0) / 10 +
    node.children.reduce((n, c) => n + visit(c), 0);
  return visit(test.root);
}

/**
 * The smallest case found that still fails. `fails` lays out a batch and answers which fail.
 * Bounded by `rounds` batches, so one stubborn case cannot hold up a run.
 */
export async function shrink(
  test: Case,
  fails: (cases: readonly Case[]) => Promise<boolean[]>,
  rounds = 60,
): Promise<Case> {
  let current = test;
  for (let round = 0; round < rounds; round++) {
    const candidates = smaller(current);
    if (!candidates.length) break;
    const failing = await fails(candidates);
    const index = failing.indexOf(true);
    if (index < 0) break;
    current = candidates[index]!;
  }
  return current;
}
