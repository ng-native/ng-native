/**
 * `:is(<compound> > *)`: a test of the node's parent, which is how Tailwind 4 writes its `*:`
 * variant. `*:rounded-full` on a list is `:is(.\*\:rounded-full > *)`: every child of it.
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

/** A parent holding a child that holds a grandchild, each with a `testID` of its name. */
function scene(css: string, parentClasses = 'p') {
  const reports: string[] = [];
  const sheet = compileCss(css, 'app.css', { onUnsupported: (m: string) => reports.push(m) });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  const make = (testID: string, under: EngineNode, classes = ''): EngineNode => {
    const node = engine.createElement('view');
    if (classes) engine.setClasses(node, classes);
    engine.setProp(node, 'testID', testID);
    engine.appendChild(under, node);
    return node;
  };
  const parent = make('parent', engine.root, parentClasses);
  const child = make('child', parent, 'x');
  const grandchild = make('grandchild', child, 'x');
  const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...all(node.children)]);
  const opacity = (testID: string): unknown => {
    engine.commit();
    return all(fabric.committed).find((node) => node.props['testID'] === testID)?.props['opacity'];
  };
  return { reports, engine, parent, child, grandchild, opacity };
}

describe(':is(<compound> > *)', () => {
  it('matches a child of the compound, and not what is further down', () => {
    const s = scene('.x:is(.p > *) { opacity: 0.5 }');
    assert.equal(s.opacity('child'), 0.5);
    assert.equal(s.opacity('grandchild'), undefined);
    assert.equal(s.opacity('parent'), undefined);
    assert.deepEqual(s.reports, []);
  });

  it('is as specific as the compound, in :is(), and weighs nothing in :where()', () => {
    // Two classes against one, then one against one with the later rule winning.
    const is = scene('.x:is(.p > *) { opacity: 0.5 } .x { opacity: 1 }');
    assert.equal(is.opacity('child'), 0.5);
    const where = scene('.x:where(.p > *) { opacity: 0.5 } .x { opacity: 1 }');
    assert.equal(where.opacity('child'), 1);
  });

  it('holds alongside what comes before it in the selector', () => {
    const s = scene('.outer .x:is(.p > *) { opacity: 0.5 }', 'p outer');
    // The parent is both the `.outer` above the child and the `.p` it is a child of.
    assert.equal(s.opacity('child'), 0.5);
    assert.equal(s.opacity('grandchild'), undefined);
  });

  it('follows the parent gaining and losing what the compound asks for', () => {
    const s = scene('.x:is(.p > *) { opacity: 0.5 }', '');
    assert.equal(s.opacity('child'), undefined);
    s.engine.addClass(s.parent, 'p');
    assert.equal(s.opacity('child'), 0.5);
    s.engine.removeClass(s.parent, 'p');
    assert.equal(s.opacity('child') ?? null, null);
  });

  it('is one alternative of a list, beside a plain compound', () => {
    const s = scene('.x:is(.p > *, .other) { opacity: 0.5 }');
    assert.equal(s.opacity('child'), 0.5);
    s.engine.addClass(s.grandchild, 'other');
    assert.equal(s.opacity('grandchild'), 0.5);
  });

  it('still refuses a longer selector inside', () => {
    const s = scene('.x:is(.a .p > *) { opacity: 0.5 }');
    assert.equal(s.reports.length, 1);
  });
});

describe("Tailwind's *: variant", () => {
  it('styles the children of the element it is on, with a variant of their own too', () => {
    const classes = '*:opacity-50 *:data-[slot=a]:opacity-25';
    const s = scene(flattenTailwind(build('native', classes)), classes);
    assert.equal(s.opacity('child'), 0.5);
    assert.equal(s.opacity('grandchild'), undefined);
    s.engine.setProp(s.child, 'data-slot', 'a');
    assert.equal(s.opacity('child'), 0.25);
    assert.deepEqual(s.reports, []);
  });
});
