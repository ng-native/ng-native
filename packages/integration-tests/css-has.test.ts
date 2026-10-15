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

  it('matches any alternative of a list with an ancestor test in it, as Chrome does', () => {
    // Chrome: a descendant of the card that is .x and either under .p or .y itself.
    const rule = '.card:has(.x:is(.p *, .y)) { opacity: 0.5 }';
    const own = scene(rule);
    const x = own.el('x', own.card);
    assert.equal(own.opacity('card'), undefined);
    own.engine.addClass(x, 'y');
    assert.equal(own.opacity('card'), 0.5);
    assert.deepEqual(own.reports, []);
    own.engine.removeClass(x, 'y');
    assert.equal(own.opacity('card') ?? null, null);

    // The ancestor may be anywhere above the descendant, the card's own ancestors included.
    const above = scene(rule);
    const outer = above.el('');
    const card = above.el('card', outer);
    above.engine.setProp(card, 'testID', 'outer card');
    above.el('x', card);
    assert.equal(above.opacity('outer card'), undefined);
    above.engine.addClass(outer, 'p');
    assert.equal(above.opacity('outer card'), 0.5);
    above.engine.removeClass(outer, 'p');
    assert.equal(above.opacity('outer card') ?? null, null);

    const child = scene('.card:has(> .x:is(.p > *, .y)) { opacity: 0.5 }');
    const p = child.el('p', child.card);
    child.el('x', p);
    assert.equal(child.opacity('card'), undefined, 'the .x under .p is no child of the card');
    child.el('x y', child.card);
    assert.equal(child.opacity('card'), 0.5);
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

describe(':has() on a box the styled node is in', () => {
  // A component library's own: `.field:has(.input:focus) .label`, a label moved by what is in
  // the field beside it, and `.group:has(.button) .input`, a field squared off for its button.
  const ABOVE = '.card:has(.action) .title { opacity: 0.5 }';
  const titled = (css = ABOVE) => {
    const s = scene(css);
    const body = s.el('body', s.card);
    const title = s.el('title', body);
    s.engine.setProp(title, 'testID', 'title');
    return { ...s, body, title };
  };

  it('styles the node where the box has what is asked, and not where it has not', () => {
    const s = titled();
    assert.equal(s.opacity('title'), undefined);
    const action = s.el('action', s.card);
    assert.equal(s.opacity('title'), 0.5);
    assert.deepEqual(s.reports, []);
    s.engine.removeChild(s.card, action);
    assert.equal(s.opacity('title') ?? null, null);
  });

  it('follows a class coming to what is in the box, and going', () => {
    const s = titled();
    const button = s.el('button', s.card);
    assert.equal(s.opacity('title'), undefined);
    s.engine.addClass(button, 'action');
    assert.equal(s.opacity('title'), 0.5);
    s.engine.removeClass(button, 'action');
    assert.equal(s.opacity('title') ?? null, null);
  });

  it('is asked of a parent after >, and of any box above with a space', () => {
    const s = titled(
      '.card:has(.action) > .title { opacity: 0.5 } .card:has(> .mark) .title { opacity: 0.25 }',
    );
    s.el('action', s.card);
    // The title is in the body, which is in the card: no child of the card.
    assert.equal(s.opacity('title'), undefined);
    s.el('mark', s.body);
    assert.equal(s.opacity('title'), undefined);
    s.el('mark', s.card);
    assert.equal(s.opacity('title'), 0.25);
  });

  it('follows what is in a box that a box above the node is asked to be inside', () => {
    // `.body:is(.card:has(.action) *) .title`: the box asked is one the body is in.
    const s = titled('.body:is(.card:has(.action) *) .title { opacity: 0.5 }');
    assert.deepEqual(s.reports, []);
    assert.equal(s.opacity('title'), undefined);
    const button = s.el('button', s.card);
    assert.equal(s.opacity('title'), undefined);
    s.engine.addClass(button, 'action');
    assert.equal(s.opacity('title'), 0.5);
    s.engine.removeClass(button, 'action');
    assert.equal(s.opacity('title') ?? null, null);
  });

  it('asks nothing more once the sheet that asked is taken away', () => {
    const s = titled('.unused { opacity: 1 }');
    const sheet = compileCss(ABOVE, 'more.css', { onUnsupported: () => {} });
    s.engine.addGlobalSheet(sheet);
    s.el('action', s.card);
    assert.equal(s.opacity('title'), 0.5);
    s.engine.removeGlobalSheet(sheet);
    assert.equal(s.opacity('title') ?? null, null);
    const before = s.title.styleCache;
    s.el('action', s.card);
    s.engine.commit();
    assert.equal(s.title.styleCache, before, 'nothing under the box was matched again');
  });

  it('styles again only what such a rule is for, of all that is in the box', () => {
    const s = titled();
    const other = s.el('other', s.body);
    s.engine.commit();
    const before = other.styleCache;
    s.el('action', s.card);
    assert.equal(s.opacity('title'), 0.5);
    assert.equal(other.styleCache, before, 'what no such rule is for was not resolved again');
  });
});

describe(':has() the engine does not take', () => {
  it('refuses what it cannot match and what a browser drops, each by name', () => {
    for (const [css, why] of [
      ['.card:has(.action) + .title { opacity: 0.5 }', /the node the rule styles/],
      ['.card:has(.action) ~ .panel .title { opacity: 0.5 }', /the node the rule styles/],
      ['.card:has(.a .b) { opacity: 0.5 }', /one compound/],
      ['.card:has(+ .next) { opacity: 0.5 }', /one compound/],
      ['.card:has(~ .later) { opacity: 0.5 }', /one compound/],
      // Chrome drops each of these as invalid: no ':has()' inside another.
      ['.card:has(.a:has(.b)) { opacity: 0.5 }', /inside another/],
      ['.card:has(.a:not(:has(.b))) { opacity: 0.5 }', /inside another/],
      ['.card:has(:is(.a:has(.b))) { opacity: 0.5 }', /inside another/],
      ['.card .title:has(> .a:has(.b)) { opacity: 0.5 }', /inside another/],
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
