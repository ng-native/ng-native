/**
 * What is left of a screen once it is gone: nothing.
 *
 * Every engine node holds its committed Fabric handle, and on a device that handle is the JSI
 * object keeping the native shadow node alive. So an engine node that stays reachable after its
 * screen is destroyed is not a small leak: through its parent and children it reaches every other
 * node of the screen, and through their handles every native node. A screen of a few hundred texts
 * pushed and popped a hundred times kept a gigabyte that way.
 *
 * The proof here is the garbage collector's own: a `WeakRef` to every node and every handle of a
 * screen while it is showing, and after it has gone and a full collection has run, none of them may
 * still resolve. Anything the engine, the outlet or the router still holds shows up as a count.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import type { Type, WritableSignal } from '@angular/core';
import type { Routes } from '@angular/router';
import { Engine, registerHoist, type EngineNode } from '@ng-native/fabric';
import { cleanup, createFakeFabric, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;
const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

/** A macrotask between each pass, because a `WeakRef` holds its target until the job ends. */
async function collect(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    gc();
  }
}

/** Every node under `node`, itself included, and every Fabric handle any of them committed. */
function watch(node: EngineNode, into: WeakRef<object>[]): void {
  into.push(new WeakRef(node));
  const handle = node.committed?.handle;
  if (handle) into.push(new WeakRef(handle));
  for (const child of node.children) watch(child, into);
}

const alive = (refs: readonly WeakRef<object>[]) => refs.filter((ref) => ref.deref()).length;

describe('a screen that has gone', () => {
  let mod: Record<string, unknown>;
  let navigation: NativeNavigation;
  let hosts: EngineNode[];
  let live: WritableSignal<number>;

  before(async () => {
    mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/screen-lifetime.ts', import.meta.url)),
    );
    hosts = mod['hosts'] as EngineNode[];
    live = mod['live'] as WritableSignal<number>;
  });

  beforeEach(async () => {
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [provideNativeRouter(mod['routes'] as Routes)],
    });
    navigation = app.componentRef.injector.get(NativeNavigation);
    await settle();
  });

  after(() => cleanup());

  /** Show each url in turn and go back from it, watching every node of every page shown. */
  async function visit(urls: readonly string[], present = false): Promise<WeakRef<object>[]> {
    const refs: WeakRef<object>[] = [];
    for (const url of urls) {
      if (present) await navigation.present(url, { as: 'modal' });
      else await navigation.push(url);
      await settle();
      watch(hosts.pop()!, refs);
      navigation.back();
      await settle();
    }
    hosts.length = 0;
    await collect();
    return refs;
  }

  it('lets go of a popped screen that has a header, every node and every handle', async () => {
    const refs = await visit(Array.from({ length: 10 }, () => '/headed'));
    assert.equal(live(), 0, 'every page was destroyed');
    assert.ok(refs.length > 10 * 150, 'the pages were watched in full');
    assert.equal(alive(refs), 0);
  });

  it('lets go of the last screen shown at a url that is never shown again', async () => {
    const refs = await visit(['/bare/1', '/bare/2', '/bare/3', '/headed/4']);
    assert.equal(live(), 0);
    assert.equal(alive(refs), 0);
  });

  it('lets go of a presented screen once it is dismissed', async () => {
    const refs = await visit(
      Array.from({ length: 10 }, () => '/modal'),
      true,
    );
    assert.equal(live(), 0);
    assert.equal(alive(refs), 0);
  });
});

describe('a subtree out of the tree', () => {
  registerHoist('native-header', 'screen');

  /** A screen whose header is written inside a view, as a page's layout component puts it. */
  function scene(css = '') {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: css ? compileCss(css) : null });
    const stack = engine.createElement('stack');
    const screen = engine.createElement('screen');
    const frame = engine.createElement('view');
    const header = engine.createElement('native-header');
    engine.appendChild(engine.root, stack);
    engine.appendChild(stack, screen);
    engine.appendChild(screen, frame);
    engine.appendChild(frame, header);
    engine.commit();
    const committedScreen = (): FakeFabricNode | undefined => fabric.committed[0]?.children[0];
    return { engine, fabric, stack, screen, frame, header, committedScreen };
  }

  it('still hoists its header when it is put back', () => {
    const s = scene();
    const names = () => s.committedScreen()?.children.map((child) => child.viewName);
    assert.equal(names()?.length, 2, 'the header commits beside the frame it was written in');

    s.engine.removeChild(s.stack, s.screen);
    s.engine.commit();
    assert.equal(s.fabric.committed[0]?.children.length, 0);

    s.engine.appendChild(s.stack, s.screen);
    s.engine.commit();
    assert.equal(names()?.length, 2, 'and still does once the screen is back');
  });

  it('commits its header beside the frame again once something inside it changes', () => {
    // Put back untouched, the screen's old commit is reused whole, which hides where the header
    // would land; a change inside makes the screen commit its children afresh.
    const s = scene();
    s.engine.removeChild(s.stack, s.screen);
    s.engine.commit();
    s.engine.appendChild(s.stack, s.screen);
    s.engine.setProp(s.frame, 'testID', 'frame');
    s.engine.commit();
    assert.equal(
      s.committedScreen()?.children.length,
      2,
      'the frame, then the header hoisted beside it',
    );
    assert.equal(s.committedScreen()?.children[0]?.children.length, 0, 'not inside the frame');
  });

  it('is released when it never comes back, whatever was hoisted inside it', async () => {
    const s = scene();
    const refs: WeakRef<object>[] = [];
    watch(s.screen, refs);
    s.engine.removeChild(s.stack, s.screen);
    s.engine.commit();
    const { engine, stack } = s;
    Object.assign(s, { screen: null, frame: null, header: null });
    await collect();
    assert.equal(alive(refs), 0);
    assert.equal(engine.root.children[0], stack, 'the engine itself is still in use');
  });

  it('stops an endless animation on a node that left, and starts it again if it returns', async () => {
    const s = scene(`
      @keyframes spin { from { opacity: 0 } to { opacity: 1 } }
      .spinner { animation: spin 1s linear infinite; }
    `);
    const spinner = s.engine.createElement('view');
    s.engine.addClass(spinner, 'spinner');
    s.engine.appendChild(s.frame, spinner);
    s.engine.commit();
    assert.equal(s.engine.animating, true);

    s.engine.removeChild(s.stack, s.screen);
    s.engine.commit();
    assert.equal(s.engine.animating, false, 'no frame loop for a node nobody can see');

    s.engine.appendChild(s.stack, s.screen);
    s.engine.commit();
    assert.equal(s.engine.animating, true);
  });
});

describe('hoisting', () => {
  registerHoist('native-header', 'screen');
  registerHoist('config-node', 'config-host', { standIn: { hidden: true } });

  it('leaves a header that is already a direct child of the nearest screen where it is', () => {
    // A stack inside a screen, as a nested navigator is: the header belongs to the inner screen.
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const outer = engine.createElement('screen');
    const stack = engine.createElement('stack');
    const inner = engine.createElement('screen');
    const header = engine.createElement('native-header');
    engine.appendChild(engine.root, outer);
    engine.appendChild(outer, stack);
    engine.appendChild(stack, inner);
    engine.appendChild(inner, header);
    engine.commit();
    const committedInner = fabric.committed[0]!.children[0]!.children[0]!;
    assert.equal(committedInner.children.length, 1, 'the header, in the inner screen');
  });

  /** A host with a config node written inside a wrapper, the way a page writes a header. */
  function standInScene() {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const host = engine.createElement('config-host');
    const wrapper = engine.createElement('view');
    const config = engine.createElement('config-node');
    engine.setProp(config, 'title', 'First');
    engine.appendChild(engine.root, host);
    engine.appendChild(host, wrapper);
    engine.appendChild(wrapper, config);
    engine.commit();
    const committedConfig = () => fabric.committed[0]!.children[1];
    return { fabric, engine, host, wrapper, config, committedConfig };
  }

  it('keeps the native view with the stand-in props once the element leaves, sent once', () => {
    const s = standInScene();
    const tag = s.committedConfig()!.reactTag;
    s.engine.removeChild(s.wrapper, s.config);
    s.engine.commit();
    assert.equal(s.committedConfig()!.reactTag, tag, 'the same native view');
    assert.equal(s.committedConfig()!.props['hidden'], true);

    const clones = { ...s.fabric.calls };
    s.engine.setProp(s.wrapper, 'testID', 'moved');
    s.engine.commit();
    const cloned = (key: keyof typeof clones) => s.fabric.calls[key] - clones[key];
    assert.equal(
      cloned('cloneWithChildren') + cloned('cloneWithChildrenAndProps') + cloned('cloneWithProps'),
      2,
      'the wrapper and the host re-clone; the stand-in is not sent again',
    );
  });

  it('leaves a stand-in behind with its host when the host leaves the tree and comes back', () => {
    // The stand-in is a child of the host's native view. A host out of the tree at a commit is
    // created afresh when it returns, and a view of the old one cannot be appended to it.
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const container = engine.createElement('view');
    const host = engine.createElement('config-host');
    const config = engine.createElement('config-node');
    engine.appendChild(engine.root, container);
    engine.appendChild(container, host);
    engine.appendChild(host, config);
    engine.commit();
    engine.removeChild(host, config);
    engine.commit();
    const standIn = fabric.committed[0]!.children[0]!.children[0]!;
    assert.equal(standIn.props['hidden'], true, 'the stand-in holds the slot');

    engine.removeChild(container, host);
    engine.commit();
    engine.appendChild(container, host);
    engine.commit();
    const back = fabric.committed[0]!.children[0]!;
    assert.deepEqual(back.children, [], 'no view of the old host');

    const next = engine.createElement('config-node');
    engine.appendChild(host, next);
    engine.commit();
    const adopted = fabric.committed[0]!.children[0]!.children[0]!;
    assert.notEqual(adopted.reactTag, standIn.reactTag, 'created under the new host');
  });

  it('lets the next element adopt the native view and replace the stand-in props', () => {
    const s = standInScene();
    const tag = s.committedConfig()!.reactTag;
    s.engine.removeChild(s.wrapper, s.config);
    s.engine.commit();

    const next = s.engine.createElement('config-node');
    s.engine.appendChild(s.wrapper, next);
    s.engine.commit();
    assert.equal(s.committedConfig()!.reactTag, tag, 'adopted rather than created');
    assert.notEqual(s.committedConfig()!.props['hidden'], true, 'no longer the stand-in');
  });
});
