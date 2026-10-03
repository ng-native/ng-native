/**
 * `:has()`: a node styled by what is beneath it. The argument is one compound, a descendant by
 * default and a child after `>`, and the node asked is the one the rule styles.
 *
 * A change beneath a node cannot mark it for restyling as a change to the node does, since that
 * restyles everything under it. The ancestors of a changed node are matched again instead, and
 * restyled only where the rules they match came out different.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { build } from './tailwind-cli.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');
const { flattenTailwind } = require('@ng-native/tailwind') as {
  flattenTailwind(css: string): string;
};

function scene(css: string) {
  const reports: string[] = [];
  const sheet = compileCss(css, 'app.css', { onUnsupported: (m: string) => reports.push(m) });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  /** An element with `classes`, under `parent` or the root. */
  const el = (classes: string, parent: EngineNode = engine.root, name = 'view'): EngineNode => {
    const node = engine.createElement(name);
    if (classes) engine.setClasses(node, classes);
    engine.appendChild(parent, node);
    return node;
  };
  const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...all(node.children)]);
  /** The committed opacity of the view with `testID`. */
  const opacity = (testID: string): unknown => {
    engine.commit();
    return all(fabric.committed).find((node) => node.props['testID'] === testID)?.props['opacity'];
  };
  const card = el('card');
  engine.setProp(card, 'testID', 'card');
  return { sheet, reports, engine, el, opacity, card };
}

const RULE = '.card:has(.action) { opacity: 0.5 }';

describe(':has()', () => {
  it('matches a node with a matching descendant, at any depth', () => {
    const s = scene(RULE);
    assert.equal(s.opacity('card'), undefined);
    s.el('action', s.el('header', s.card));
    assert.equal(s.opacity('card'), 0.5);
    assert.deepEqual(s.reports, []);
  });

  it('matches only a child after >', () => {
    const s = scene('.card:has(> .action) { opacity: 0.5 }');
    const header = s.el('header', s.card);
    const deep = s.el('action', header);
    assert.equal(s.opacity('card'), undefined);
    assert.deepEqual(s.reports, []);
    s.engine.removeChild(header, deep);
    s.el('action', s.card);
    assert.equal(s.opacity('card'), 0.5);
  });

  it('takes an element name, an attribute, a state and a list', () => {
    const attribute = scene('.card:has([data-slot="action"]) { opacity: 0.5 }');
    attribute.engine.setProp(attribute.el('', attribute.card), 'data-slot', 'action');
    assert.equal(attribute.opacity('card'), 0.5);

    const type = scene('.card:has(image) { opacity: 0.5 }');
    type.el('', type.card, 'image');
    assert.equal(type.opacity('card'), 0.5);

    const list = scene('.card:has(.a, .b) { opacity: 0.5 }');
    list.el('b', list.card);
    assert.equal(list.opacity('card'), 0.5);

    const disabled = scene('.card:has(:disabled) { opacity: 0.5 }');
    const field = disabled.el('', disabled.card);
    assert.equal(disabled.opacity('card'), undefined);
    disabled.engine.setProp(field, 'disabled', true);
    assert.equal(disabled.opacity('card'), 0.5);
  });

  it('is negated by :not()', () => {
    const s = scene('.card:not(:has(.action)) { opacity: 0.5 }');
    assert.equal(s.opacity('card'), 0.5);
    s.el('action', s.card);
    assert.equal(s.opacity('card') ?? null, null);
  });

  it('is as specific as its argument', () => {
    // Two classes beat the one that comes later in the sheet.
    const s = scene('.card:has(.action) { opacity: 0.5 } .card { opacity: 1 }');
    s.el('action', s.card);
    assert.equal(s.opacity('card'), 0.5);
  });
});

describe(':has() as what is beneath a node changes', () => {
  it('follows a descendant arriving and leaving', () => {
    const s = scene(RULE);
    const header = s.el('header', s.card);
    assert.equal(s.opacity('card'), undefined);
    const action = s.el('action', header);
    assert.equal(s.opacity('card'), 0.5);
    s.engine.removeChild(header, action);
    assert.equal(s.opacity('card') ?? null, null);
  });

  it('follows a descendant gaining and losing what the argument asks for', () => {
    const s = scene(`${RULE} .card:has([data-on]) { opacity: 0.25 }`);
    const inner = s.el('', s.el('header', s.card));
    assert.equal(s.opacity('card'), undefined);
    s.engine.addClass(inner, 'action');
    assert.equal(s.opacity('card'), 0.5);
    s.engine.setProp(inner, 'data-on', true);
    assert.equal(s.opacity('card'), 0.25);
    s.engine.setProp(inner, 'data-on', null);
    assert.equal(s.opacity('card'), 0.5);
    s.engine.removeClass(inner, 'action');
    assert.equal(s.opacity('card') ?? null, null);
  });

  it('restyles what inherits from the node, and nothing when the answer is the same', () => {
    const s = scene('.card:has(.action) { color: red } .other { opacity: 1 }');
    const title = s.el('', s.card, 'text');
    s.engine.setProp(title, 'testID', 'title');
    const colour = () => {
      s.engine.commit();
      return title.styleCache?.style['color'];
    };
    assert.equal(colour(), undefined);
    const action = s.el('action', s.card);
    assert.equal(colour(), 'rgb(255, 0, 0)');

    // A change beneath that leaves the answer as it was resolves the card again and no more.
    const before = title.styleCache;
    s.engine.addClass(action, 'other');
    s.engine.commit();
    assert.equal(title.styleCache, before, 'the title was not resolved again');
  });
});

describe(':has() the engine does not take', () => {
  it('refuses one on an ancestor, a combinator inside, and a sibling, each by name', () => {
    for (const [css, why] of [
      ['.card:has(.action) .title { opacity: 0.5 }', /the node the rule styles/],
      ['.card:has(.a .b) { opacity: 0.5 }', /one compound/],
      ['.card:has(+ .next) { opacity: 0.5 }', /one compound/],
      ['.card:has(~ .later) { opacity: 0.5 }', /one compound/],
    ] as const) {
      const s = scene(css);
      assert.equal(s.reports.length, 1, css);
      assert.match(s.reports[0]!, why, css);
    }
  });

  it('marks a sheet that asks, and no other', () => {
    assert.equal((scene(RULE).sheet as { has?: true }).has, true);
    assert.equal((scene('.card { opacity: 1 }').sheet as { has?: true }).has, undefined);
  });
});

describe('Tailwind', () => {
  it('reads has-[...], has-[>...] and has-data-[...]', () => {
    const classes = 'has-[.action]:opacity-50 has-data-[slot=media]:p-4 has-[>image]:m-2';
    const s = scene(flattenTailwind(build('native', classes)));
    s.engine.setClasses(s.card, classes);
    const props = () => {
      s.engine.commit();
      return s.card.styleCache!.style;
    };
    assert.equal(s.opacity('card'), undefined);
    const child = s.el('action', s.card);
    assert.equal(s.opacity('card'), 0.5);
    s.engine.setProp(child, 'data-slot', 'media');
    assert.equal(props()['paddingTop'], 16);
    assert.equal(props()['marginTop'], undefined);
    s.el('', s.card, 'image');
    assert.equal(props()['marginTop'], 8);
    assert.deepEqual(s.reports, []);
  });
});
