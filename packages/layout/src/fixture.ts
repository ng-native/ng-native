/**
 * A layout fixture: a tree of boxes, each with the CSS written on it.
 *
 * The fixtures are Taffy's, which are plain: nested `<div>`s with a `style` attribute, a class or
 * two, and sometimes text in the Ahem font. That is all this reads.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATED } from './generated-fixtures.ts';

export interface FixtureNode {
  readonly style: Readonly<Record<string, string>>;
  readonly classes: readonly string[];
  /** Text written directly in the box, with a zero-width space wherever a line may break. */
  readonly text: string;
  readonly children: readonly FixtureNode[];
}

/** A node's box: left, top, width, height against its parent's border box, then its children. */
export type Box = readonly [number, number, number, number, readonly Box[]];

export const FIXTURES = fileURLToPath(new URL('../fixtures/taffy', import.meta.url));
export const SUITES = ['block', 'blockflex', 'grid', 'blockgrid', 'gridflex'] as const;

/**
 * Fixtures this cannot read: two build their styles in a script, and one has an unclosed
 * attribute upstream that swallows the fixture after it on a shared page.
 */
const UNREADABLE = /overlarge_auto_repeat|grid_span_2_max_content_auto_indefinite_hidden/;

/** Every fixture, by `suite/name`: Taffy's files, then the generated ones. */
export function fixtureNames(): string[] {
  return [...taffyNames(), ...Object.keys(GENERATED)];
}

function taffyNames(): string[] {
  return SUITES.flatMap((suite) =>
    readdirSync(join(FIXTURES, suite))
      .filter((file) => file.endsWith('.html') && !UNREADABLE.test(file))
      .sort()
      .map((file) => `${suite}/${file.slice(0, -'.html'.length)}`),
  );
}

/** The markup of a fixture's root box, as written. */
export function fixtureMarkup(name: string): string {
  const generated = GENERATED[name];
  if (generated) return generated;
  const html = readFileSync(join(FIXTURES, `${name}.html`), 'utf8');
  const start = html.indexOf('<div id="test-root"');
  const end = html.lastIndexOf('</body>');
  if (start < 0 || end < 0) throw new Error(`${name}: no #test-root`);
  return html.slice(start, end).trim();
}

const attribute = (attributes: string, name: string): string =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1] ?? '';

function declarations(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon > 0) out[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
  }
  return out;
}

export function parseFixture(name: string): FixtureNode {
  type Open = { style: Record<string, string>; classes: string[]; text: string; children: Open[] };
  const stack: Open[] = [];
  let root: Open | undefined;
  for (const [, attributes, close, text] of fixtureMarkup(name).matchAll(
    /<div([^>]*)>|(<\/div>)|([^<]+)/g,
  )) {
    if (attributes !== undefined) {
      const node: Open = {
        style: declarations(attribute(attributes, 'style')),
        classes: attribute(attributes, 'class').split(/\s+/).filter(Boolean),
        text: '',
        children: [],
      };
      stack.at(-1)?.children.push(node);
      root ??= node;
      stack.push(node);
    } else if (close) {
      stack.pop();
    } else if (text && stack.length) {
      stack.at(-1)!.text += text.replace(/&ZeroWidthSpace;|&#8203;/g, '​').trim();
    }
  }
  if (!root || stack.length) throw new Error(`${name}: unbalanced markup`);
  return root;
}
