/**
 * A layout case: a small tree of boxes, each with the declarations written on it, and the
 * stylesheet both sides are given. A box is `.n<index>`, numbered in document order, so a case
 * prints as plain CSS and a tree of names.
 */

export type Declaration = readonly [property: string, value: string];

export interface CaseNode {
  readonly declarations: readonly Declaration[];
  readonly children: readonly CaseNode[];
  /** Text in the box, in a text element of its own: ten points a character, twenty a line. */
  readonly text?: string;
}

export interface Case {
  /** The seed the case was generated from, so it can be generated again. */
  readonly seed: number;
  readonly root: CaseNode;
}

/** Every box in document order, with its name. */
export function boxes(root: CaseNode): { name: string; node: CaseNode; parent?: CaseNode }[] {
  const out: { name: string; node: CaseNode; parent?: CaseNode }[] = [];
  const visit = (node: CaseNode, parent?: CaseNode) => {
    out.push({ name: `n${out.length}`, node, parent });
    for (const child of node.children) visit(child, node);
  };
  visit(root);
  return out;
}

/** The stylesheet: one rule per box that has declarations. */
export function stylesheet(root: CaseNode): string {
  return boxes(root)
    .filter(({ node }) => node.declarations.length)
    .map(
      ({ name, node }) =>
        `.${name} { ${node.declarations.map(([p, v]) => `${p}: ${v}`).join('; ')} }`,
    )
    .join('\n');
}

/** The tree as indented names, with any text, for a report. */
export function outline(root: CaseNode): string {
  const lines: string[] = [];
  let index = 0;
  const visit = (node: CaseNode, depth: number) => {
    const text = node.text === undefined ? '' : ` "${node.text}"`;
    lines.push(`${'  '.repeat(depth)}n${index++}${text}`);
    for (const child of node.children) visit(child, depth + 1);
  };
  visit(root, 0);
  return lines.join('\n');
}

/** The boxes not laid out at all: under or at a `display: none`. */
export function hidden(root: CaseNode): Set<string> {
  const out = new Set<string>();
  let index = 0;
  const visit = (node: CaseNode, inside: boolean) => {
    const none = inside || node.declarations.some(([p, v]) => p === 'display' && v === 'none');
    if (none) out.add(`n${index}`);
    index++;
    for (const child of node.children) visit(child, none);
  };
  visit(root, false);
  return out;
}
