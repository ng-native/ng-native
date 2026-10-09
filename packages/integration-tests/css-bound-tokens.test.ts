/**
 * A custom property set on an element, `[style.--tint]="tint()"` or `style="--tint: red"`, rather
 * than in a stylesheet: in scope for that element's rules and its descendants', as on the web.
 *
 * A stylesheet's custom properties are converted when the app is built, into every form a use
 * site might read. A bound one only exists at run time, so its value is converted then, from the
 * few shapes a binding holds: a length in `px` or `%`, a number, a colour, or a word. It is never
 * a prop of its own: Fabric has no `--tint`, and before this it was sent one, as `-Tint`.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import {
  cleanup,
  createFakeFabric,
  render,
  type FakeFabric,
  type FakeFabricNode,
  compileCss,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';
import { committedProps } from './tailwind-cli.ts';

after(cleanup);

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

interface Fixture {
  tint: { set(value: string): void };
  gap: { set(value: string | null): void };
}

describe('a custom property set on an element', () => {
  let Host: Type<Fixture>;
  let fabric: FakeFabric;
  let result: Awaited<ReturnType<typeof render>>;

  const byId = (id: string): FakeFabricNode => {
    const node = flatten(fabric.committed).find((n) => n.props['nativeID'] === id);
    assert.ok(node, `a node with nativeID ${id}`);
    return node;
  };

  before(async () => {
    const mod = await compileFixture('fixtures/style-custom-property.ts');
    Host = mod['StyleCustomProperty'] as Type<Fixture>;
  });

  const boot = async () => {
    result = await render(Host);
    fabric = result.fabric;
  };

  it("is read by the element's own rules", async () => {
    await boot();
    assert.equal(byId('bound').props['backgroundColor'], 'rgb(0, 0, 255)');
    assert.equal(byId('bound').props['paddingTop'], 4, 'by the name it was written with');
  });

  it('is read by the rules of what is inside it', async () => {
    await boot();
    assert.equal(byId('inside').props['borderTopColor'], 'rgb(0, 0, 255)');
    assert.equal(byId('inside').props['opacity'], 3, 'a number stays a number');
  });

  it('works from a static style attribute too', async () => {
    await boot();
    assert.equal(byId('static').props['backgroundColor'], 'rgb(0, 128, 0)');
  });

  it('leaves an element that does not set it on the fallback', async () => {
    await boot();
    assert.equal(byId('unset').props['backgroundColor'], 'rgb(0, 0, 0)');
    assert.equal(byId('unset').props['paddingTop'], 1);
  });

  it('follows the binding when it changes, and falls back when it is removed', async () => {
    await boot();
    (result.instance as Fixture).tint.set('rgb(255, 0, 0)');
    (result.instance as Fixture).gap.set(null);
    await result.rerender();
    assert.equal(byId('bound').props['backgroundColor'], 'rgb(255, 0, 0)');
    assert.equal(byId('inside').props['borderTopColor'], 'rgb(255, 0, 0)');
    assert.equal(byId('bound').props['paddingTop'], 1);
  });

  it('is never sent to Fabric as a prop', async () => {
    await boot();
    for (const node of flatten(fabric.committed)) {
      const stray = Object.keys(node.props).filter((key) => key.startsWith('-'));
      assert.deepEqual(stray, [], `${node.viewName} ${String(node.props['nativeID'])}`);
    }
  });
});

describe('the value a binding holds', () => {
  /** The props an element of class `a` commits with, given custom properties set on it. */
  const committed = (css: string, custom: Record<string, unknown>) => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const node = engine.createElement('view', compileCss(css, 'bound'));
    engine.addClass(node, 'a');
    for (const [name, value] of Object.entries(custom)) engine.setCustomProperty(node, name, value);
    engine.appendChild(engine.root, node);
    engine.commit();
    return fabric.committed[0]!.props;
  };

  it('takes a bare 0 as a length, as CSS takes it wherever a length goes', () => {
    assert.equal(committed('.a { gap: var(--g, 5px) }', { '--g': 0 })['rowGap'], 0);
  });

  it('takes a colour name as a colour, for a use site that wants one', () => {
    const props = committed('.a { border-color: var(--c, black) }', { '--c': 'red' });
    assert.equal(props['borderTopColor'], 'red');
  });

  it('takes bold and normal as the weights they name', () => {
    assert.equal(
      committed('.a { font-weight: var(--w, 300) }', { '--w': 'bold' })['fontWeight'],
      '700',
    );
  });

  it('takes a number as a weight, as a stylesheet token of one is', () => {
    // `[style.--w]="600"` beside `font-weight: var(--w)`: a stylesheet's `--w: 600` is a weight,
    // and a bound one was a number only, so the text kept the fallback.
    const weight = (value: unknown) =>
      committed('.a { font-weight: var(--w, 300) }', { '--w': value })['fontWeight'];
    assert.equal(weight(600), '600');
    assert.equal(weight('600'), '600');
    assert.equal(weight(550), '600', 'at a weight native draws');
  });

  it('takes three channels as the channels a colour is built from', () => {
    const colour = (css: string, value: string) => committed(css, { '--c': value })['color'];
    assert.equal(colour('.a { color: hsl(var(--c, 0 0% 0%)) }', '240 100% 50%'), 'rgb(0, 0, 255)');
    assert.equal(colour('.a { color: rgb(var(--c, 0 0 0)) }', '13 110 253'), 'rgb(13, 110, 253)');
    assert.equal(colour('.a { color: rgb(var(--c, 0 0 0)) }', '13, 110, 253'), 'rgb(13, 110, 253)');
    assert.equal(colour('.a { color: rgb(var(--c, 0 0 0)) }', '100% 0% 0%'), 'rgb(255, 0, 0)');
    assert.equal(colour('.a { color: hsl(var(--c, 0 0% 0%)) }', '240 100 50'), 'rgb(0, 0, 255)');
    assert.equal(
      colour('.a { color: rgb(var(--c)) }', '0 100% 50%'),
      undefined,
      'not rgb() channels',
    );
    // Set, so substituted rather than falling back, and no colour, so the property is unset.
    assert.equal(colour('.a { color: rgb(var(--c, 1 2 3)) }', '1.2.3 4 5'), undefined);
  });

  it('keeps apart rows that match alike but sit under different tokens', () => {
    // Nodes that match the same rules under the same parent share one worked-out style; a row that
    // sets a token of its own must not hand its colour to the rows beside it, or they theirs to it.
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const sheet = compileCss('.row { gap: 1px } .dot { color: var(--c, red) }', 'rows');
    const rows = [0, 1, 2].map(() => {
      const row = engine.createElement('view', sheet);
      const dot = engine.createElement('view', sheet);
      engine.addClass(row, 'row');
      engine.addClass(dot, 'dot');
      engine.appendChild(row, dot);
      engine.appendChild(engine.root, row);
      return { row, dot };
    });
    engine.setCustomProperty(rows[1]!.row, '--c', 'blue');
    engine.commit();
    const RED = 'rgb(255, 0, 0)';
    const colours = () => rows.map(({ dot }) => committedProps(fabric, dot)['color']);
    assert.deepEqual(colours(), [RED, 'blue', RED]);
    engine.setCustomProperty(rows[1]!.row, '--c', '');
    engine.setCustomProperty(rows[2]!.row, '--c', 'green');
    engine.commit();
    assert.deepEqual(colours(), [RED, RED, 'green']);
  });

  it("treats an empty value as unset, leaving the element's rule to define it", () => {
    const props = committed('.a { --g: 4px; gap: var(--g, 5px) }', { '--g': '' });
    assert.equal(props['rowGap'], 4);
  });

  it("wins over the same property defined by the element's own rule", () => {
    const props = committed('.a { --g: 4px; gap: var(--g, 5px) }', { '--g': '9px' });
    assert.equal(props['rowGap'], 9);
  });

  it('reaches descendants through elements that have no stylesheet at all', () => {
    // The outer two have no sheet, and there is no global one: the path the resolver takes for
    // an unstyled node, which still has to carry the tokens down.
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const outer = engine.createElement('view');
    const middle = engine.createElement('view');
    const inner = engine.createElement('view', compileCss('.a { gap: var(--g, 5px) }', 'bound'));
    engine.addClass(inner, 'a');
    engine.setCustomProperty(outer, '--g', '7px');
    engine.appendChild(engine.root, outer);
    engine.appendChild(outer, middle);
    engine.appendChild(middle, inner);
    engine.commit();
    assert.equal(fabric.committed[0]!.children[0]!.children[0]!.props['rowGap'], 7);
  });
});
