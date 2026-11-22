/**
 * Paint bound on a view and changed alone, as a frame of an animation driven from JavaScript
 * changes it: the engine patches what it committed rather than merging every prop again. Each
 * test here is a way the patch would commit something else than a merge does, were it taken where
 * it must not be: something else changed beside the paint, a rule stands over it, a transition
 * eases it, or the value is one only the merge reads.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { Type } from '@angular/core';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { cleanup, createFakeFabric, render, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const { compileCss } = createRequire(import.meta.url)('@ng-native/metro/css/compile.cjs');

interface Bench {
  opacity: { set(value: number | null): void };
  transform: { set(value: string | null): void };
  colour: { set(value: string | null): void };
  lit: { set(value: boolean): void };
  plain(): { nativeElement: EngineNode };
}

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

describe('paint bound on a view and changed alone', () => {
  let bench: Bench;
  let detectChanges: () => Promise<void>;
  let style: (id: string) => Record<string, unknown>;
  let errors: string[];

  beforeEach(async () => {
    errors = [];
    // The engine checks each patch against a merge in development and reports a difference.
    mock.method(console, 'error', (message: unknown) => {
      if (String(message).includes('[angular-native]')) errors.push(String(message));
    });
    const mod = await compileFixture('fixtures/paint-patch.ts');
    // As a release build runs: in development each patch is checked against a merge, which
    // commits the merge where they differ, and would hide the patch this is about.
    const result = await render(mod['PaintPatch'] as Type<unknown>, { dev: false });
    bench = result.instance as unknown as Bench;
    detectChanges = () => result.detectChanges();
    style = (id) => {
      const node = flatten(result.fabric.committed).find((one) => one.props['nativeID'] === id)!;
      return { ...node.props, ...((node.props['style'] as Record<string, unknown>) ?? {}) };
    };
  });

  afterEach(() => {
    cleanup();
    mock.restoreAll();
    assert.deepEqual(errors, [], 'no patch differed from a merge');
  });

  it('commits each new value, frame after frame', async () => {
    for (const [opacity, x, colour] of [
      [0.5, 2, '#00ff00'],
      [0.75, 3, '#00ffff'],
    ] as const) {
      bench.opacity.set(opacity);
      bench.transform.set(`translateX(${x}px)`);
      bench.colour.set(colour);
      await detectChanges();
      const plain = style('plain');
      assert.equal(plain['opacity'], opacity);
      assert.deepEqual(plain['transform'], [{ translateX: x }]);
      assert.equal(plain['backgroundColor'], colour);
    }
  });

  it('merges again where a class changes in the same frame', async () => {
    bench.opacity.set(0.5);
    await detectChanges();
    bench.opacity.set(0.6);
    bench.colour.set(null);
    bench.lit.set(true);
    await detectChanges();
    const plain = style('plain');
    assert.equal(plain['opacity'], 0.6);
    assert.equal(plain['width'], 40, "the class's other declarations are committed");
    assert.equal(plain['backgroundColor'], 'rgb(255, 0, 0)');
  });

  it('merges again where a prop changed before the paint, as a listener can change one', async () => {
    bench.opacity.set(0.5);
    await detectChanges();
    const plain = bench.plain().nativeElement;
    plain.engine!.setProp(plain, 'accessibilityLabel', 'changed');
    bench.opacity.set(0.6);
    await detectChanges();
    assert.equal(style('plain')['opacity'], 0.6);
    assert.equal(style('plain')['accessibilityLabel'], 'changed');
  });

  it('merges again where a prop changes after the paint, before the commit', async () => {
    bench.opacity.set(0.5);
    await detectChanges();
    // As the renderer sets a bound declaration, and then a listener a prop, in one frame.
    const plain = bench.plain().nativeElement;
    const engine = plain.engine as unknown as Engine;
    (plain.props['style'] as Record<string, unknown>)['opacity'] = 0.6;
    engine.styleChanged(plain, 'opacity');
    engine.setProp(plain, 'accessibilityLabel', 'after');
    engine.commit();
    assert.equal(style('plain')['opacity'], 0.6);
    assert.equal(style('plain')['accessibilityLabel'], 'after');
  });

  it('keeps a styleOverride over the bound value, one it once equalled too', async () => {
    const plain = bench.plain().nativeElement;
    const engine = plain.engine as unknown as Engine;
    engine.setProp(plain, 'styleOverride', { opacity: 1 });
    await detectChanges();
    bench.opacity.set(0.5);
    await detectChanges();
    assert.equal(style('plain')['opacity'], 1);
  });

  it("takes a rule's value back when the bound one is removed", async () => {
    bench.transform.set('translateX(2px)');
    await detectChanges();
    assert.deepEqual(style('turned')['transform'], [{ translateX: 2 }]);
    bench.transform.set(null);
    await detectChanges();
    assert.deepEqual(style('turned')['transform'], [{ rotate: '45deg' }]);
  });

  it("leaves the rule's transform where the bound one cannot be read", async () => {
    bench.transform.set('translateX(2px)');
    await detectChanges();
    bench.transform.set('spin(1turn)');
    await detectChanges();
    assert.deepEqual(style('turned')['transform'], [{ rotate: '45deg' }]);
  });

  it('keeps an !important rule over the bound value, one it once equalled too', async () => {
    bench.opacity.set(0.25);
    await detectChanges();
    bench.opacity.set(0.75);
    await detectChanges();
    assert.equal(style('pinned')['opacity'], 0.25);
  });
});

describe('paint bound on a view a transition eases', () => {
  afterEach(cleanup);

  it('is merged, which starts the transition a patch would skip', async () => {
    const mod = await compileFixture('fixtures/paint-patch.ts');
    const result = await render(mod['PaintEased'] as Type<unknown>, { dev: false });
    const eased = result.instance as unknown as {
      opacity: { set(value: number): void };
      fading(): { nativeElement: EngineNode };
    };
    eased.opacity.set(0.5);
    await result.detectChanges();
    assert.equal(eased.fading().nativeElement.transitions?.get('opacity')?.to, 0.5);
  });
});

describe('paint bound on a view a generated sheet hides', () => {
  it('keeps it unseen, where its own opacity once equalled the hidden one', () => {
    // `visibility` is read from a generated sheet, Tailwind's `invisible`, as css-visibility.test.ts.
    const sheet = compileCss('.invisible { visibility: hidden }', 'app.tailwind.css', {
      generated: true,
    });
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never, dev: false });
    const view = engine.createElement('view');
    engine.setClasses(view, 'invisible');
    // The element's own style, as the renderer sets it for \`[style.opacity]\`.
    const own: Record<string, unknown> = { opacity: 0 };
    view.ownStyle = own;
    engine.setProp(view, 'style', own);
    engine.appendChild(engine.root, view);
    engine.commit();
    assert.equal(fabric.committed[0]!.props['opacity'], 0);
    own['opacity'] = 1;
    engine.styleChanged(view, 'opacity');
    engine.commit();
    assert.equal(fabric.committed[0]!.props['opacity'], 0);
  });
});

describe('paint bound on a view whose dirty listener changes another of its props', () => {
  it('merges the prop the listener set, rather than patching the paint alone', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { dev: false });
    const view = engine.createElement('view');
    const own: Record<string, unknown> = { opacity: 0 };
    view.ownStyle = own;
    engine.setProp(view, 'style', own);
    engine.appendChild(engine.root, view);
    engine.commit();
    // The host hears the tree go dirty as the paint changes, and changes the view on the way.
    let once = true;
    engine.setOnDirty(() => {
      if (!once) return;
      once = false;
      engine.setProp(view, 'pointerEvents', 'none');
    });
    own['opacity'] = 0.5;
    engine.styleChanged(view, 'opacity');
    engine.commit();
    assert.equal(once, false, 'the listener ran');
    assert.equal(fabric.committed[0]!.props['opacity'], 0.5);
    assert.equal(fabric.committed[0]!.props['pointerEvents'], 'none');
  });
});

describe('a bound transform that makes or unmakes a containing block', () => {
  // A transform makes a static box what its absolute boxes are placed against, which Yoga knows
  // only as a position: the merge commits it `relative`, its insets dropped, while it has one, and
  // static, with them, once it goes.
  const box = (transform: string) => ({ position: 'static', left: 5, transform });
  const commitWith = (first: string, then: string) => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { dev: false });
    const view = engine.createElement('view');
    const own: Record<string, unknown> = box(first);
    view.ownStyle = own;
    engine.setProp(view, 'style', own);
    engine.appendChild(engine.root, view);
    engine.commit();
    own['transform'] = then;
    engine.styleChanged(view, 'transform');
    engine.commit();
    return fabric.committed[0]!.props;
  };
  const mergedWith = (transform: string) => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { dev: false });
    const view = engine.createElement('view');
    engine.setProp(view, 'style', box(transform));
    engine.appendChild(engine.root, view);
    engine.commit();
    const { position, left } = fabric.committed[0]!.props;
    return { position, left };
  };
  const placed = (props: Record<string, unknown>) => ({
    position: props['position'],
    // A null removes the inset committed before, as no inset commits none.
    left: props['left'] ?? undefined,
  });

  it('is merged as the transform goes', () => {
    assert.deepEqual(mergedWith('none'), { position: 'static', left: 5 });
    assert.deepEqual(placed(commitWith('translateX(2px)', 'none')), mergedWith('none'));
  });

  it('is merged as the transform comes', () => {
    assert.deepEqual(mergedWith('translateX(2px)'), { position: 'relative', left: undefined });
    assert.deepEqual(placed(commitWith('none', 'translateX(2px)')), mergedWith('translateX(2px)'));
  });

  it('is patched from one transform to another', () => {
    const props = commitWith('translateX(2px)', 'translateX(3px)');
    assert.deepEqual(props['transform'], [{ translateX: 3 }]);
    assert.deepEqual(placed(props), mergedWith('translateX(3px)'));
  });
});
