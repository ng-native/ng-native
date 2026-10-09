/**
 * `ViewEncapsulation.None`: Angular adds such a component's CSS to the document unscoped when the
 * component first renders, after the app's global styles, so its rules reach any element, its own
 * host by class among them, and `:host` in it matches nothing. The platform registers its sheet as
 * a global sheet once, and gives the component no sheet of its own.
 *
 * Chrome's answers for each case are in the oracle (`css-oracle-cases.ts`, the rows named `None:`);
 * this drives the same through Angular and the fake Fabric.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { cleanup, render, type FakeFabricNode, compileCss } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

after(cleanup);

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

interface App {
  shown: WritableSignal<boolean>;
}

describe('a ViewEncapsulation.None component', () => {
  let App: Type<App>;

  before(async () => {
    const mod = await compileFixture('fixtures/encapsulation-none.ts');
    App = mod['EncapsulationNone'] as Type<App>;
  });

  /** Each sheet an engine took in as a new global one, while the spy is in place. */
  const added: StyleSheet[] = [];
  const add = Engine.prototype.addGlobalSheet;
  before(() => {
    Engine.prototype.addGlobalSheet = function (this: Engine, sheet: StyleSheet) {
      const fresh = add.call(this, sheet);
      if (fresh) added.push(sheet);
      return fresh;
    };
  });
  after(() => {
    Engine.prototype.addGlobalSheet = add;
  });

  async function boot(globalStyles?: StyleSheet) {
    added.length = 0;
    const result = await render(App, globalStyles ? { globalStyles } : {});
    const nodes = () => flatten(result.fabric.committed);
    const byText = (text: string) =>
      nodes().find((node) => node.children.some((child) => child.props['text'] === text))!;
    return { result, nodes, byText, added };
  }

  it("styles its host by class, its own elements and the app's, but not through :host", async () => {
    const { nodes, byText } = await boot();
    const chips = nodes().filter((node) =>
      node.children.some((child) =>
        child.children.some((grandchild) => grandchild.props['text'] === 'chip'),
      ),
    );
    assert.equal(chips.length, 2);
    assert.deepEqual(
      chips.map((chip) => chip.props['paddingTop']),
      [1, 4],
      "the host class rule, and the app's own rule beating it on the second",
    );
    assert.deepEqual(
      chips.map((chip) => chip.props['marginTop']),
      [undefined, undefined],
      ':host in a None sheet matches nothing',
    );
    assert.equal(byText('chip').props['color'], 'rgb(1, 1, 1)', 'a token set on the host');
    assert.equal(byText('outside').props['backgroundColor'], 'rgb(2, 2, 2)', "the app's element");
  });

  it('registers its sheet once, however many times it renders, and keeps it across a remount', async () => {
    const { result, byText, added } = await boot();
    assert.equal(added.length, 1, 'two instances, one registration');

    result.instance.shown.set(false);
    await result.rerender();
    assert.equal(
      byText('outside').props['backgroundColor'],
      'rgb(2, 2, 2)',
      "still applied with no instance left, as with Angular's REMOVE_STYLES_ON_COMPONENT_DESTROY off",
    );

    result.instance.shown.set(true);
    await result.rerender();
    assert.equal(added.length, 1, 'no second registration on a remount');
    assert.equal(byText('chip').props['color'], 'rgb(1, 1, 1)');
  });

  it("comes after the app's global sheet, and wins a tie with it", async () => {
    const globalStyles = compileCss(
      '.none-chip { padding: 7px } .outside { background-color: rgb(8, 8, 8) } .inner { opacity: 0.25 }',
      'global',
    );
    const { nodes, byText } = await boot(globalStyles);
    const chip = nodes().find((node) =>
      node.children.some((child) => child.children.some((t) => t.props['text'] === 'chip')),
    )!;
    assert.equal(chip.props['paddingTop'], 1);
    assert.equal(byText('outside').props['backgroundColor'], 'rgb(2, 2, 2)');
    assert.equal(byText('chip').props['opacity'], 0.25, 'what the None sheet leaves alone stays');
  });

  it('leaves a Shadow DOM component scoped, as a browser scopes a shadow root', async () => {
    const { nodes, byText } = await boot();
    const shadowHost = nodes().find((node) =>
      node.children.some((child) => child.children.some((t) => t.props['text'] === 'shadow')),
    )!;
    assert.equal(shadowHost.props['paddingTop'], 3, ':host applies inside a shadow root');
    assert.equal(byText('shadow').props['color'], 'rgb(3, 3, 3)');
    assert.equal(byText('outside').props['opacity'], undefined, 'and stops at its edge');
  });
});

describe("a ViewEncapsulation.None component's sheet, hot-swapped", () => {
  it('replaces the sheet it registered, where it was, rather than adding a second', async () => {
    const { NativeRendererFactory } = await import('@ng-native/platform');
    const { createFakeFabric } = await import('@ng-native/testing');
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const factory = new NativeRendererFactory(engine);
    class Chip {}
    const def = { id: 'chip', encapsulation: 2, type: Chip };
    const styles = Chip as unknown as Record<string, unknown>;
    const sheet = (css: string) => compileCss(css, 'chip') as StyleSheet;

    styles['ɵnativeStyles'] = sheet('.a { color: rgb(1, 0, 0) } .b { color: rgb(2, 0, 0) }');
    factory.createRenderer(engine.createElement('view'), def as never);
    styles['ɵnativeStyles'] = sheet('.b { color: rgb(3, 0, 0) }');
    factory.componentReplaced('chip');
    factory.createRenderer(engine.createElement('view'), def as never);

    const a = engine.createElement('view');
    engine.addClass(a, 'a');
    const b = engine.createElement('view');
    engine.addClass(b, 'b');
    engine.appendChild(engine.root, a);
    engine.appendChild(engine.root, b);
    engine.commit();
    const [first, second] = fabric.committed;
    assert.equal(first!.props['color'], undefined, 'the edited-out rule is gone');
    assert.equal(second!.props['color'], 'rgb(3, 0, 0)');
  });
});

describe("a ViewEncapsulation.None component's sheet, hot-swapped away", () => {
  /** A None component registered with `.a`, then hot-swapped to `next`, with a node wearing `.a`. */
  async function swapTo(next: { sheet?: StyleSheet; encapsulation: number }) {
    const { NativeRendererFactory } = await import('@ng-native/platform');
    const { createFakeFabric } = await import('@ng-native/testing');
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const factory = new NativeRendererFactory(engine);
    class Chip {}
    const styles = Chip as unknown as Record<string, unknown>;
    styles['ɵnativeStyles'] = compileCss('.a { color: rgb(1, 0, 0) }', 'chip') as StyleSheet;
    factory.createRenderer(engine.createElement('view'), {
      id: 'chip',
      encapsulation: 2,
      type: Chip,
    } as never);
    // What the hot update leaves on the class: no sheet at all once every rule is gone.
    styles['ɵnativeStyles'] = next.sheet;
    factory.componentReplaced('chip');
    factory.createRenderer(engine.createElement('view'), {
      id: 'chip',
      encapsulation: next.encapsulation,
      type: Chip,
    } as never);

    const a = engine.createElement('view');
    engine.addClass(a, 'a');
    engine.appendChild(engine.root, a);
    engine.commit();
    return fabric.committed[0]!.props['color'];
  }

  it('drops the sheet it registered when the edit leaves no rules', async () => {
    assert.equal(await swapTo({ encapsulation: 2 }), undefined);
  });

  it('drops it when the edit makes the component emulated, whose sheet is its own', async () => {
    const sheet = compileCss('.b { color: rgb(2, 0, 0) }', 'chip') as StyleSheet;
    assert.equal(await swapTo({ sheet, encapsulation: 0 }), undefined);
  });
});
