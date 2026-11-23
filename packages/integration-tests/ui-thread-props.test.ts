/**
 * Props the UI thread drew a view with and has let go of (`Engine.setUiThreadProps`).
 *
 * Reanimated re-applies every view it holds values for to each commit React Native makes, cloning
 * the view and each ancestor, so a view it never lets go of makes every commit dearer. It lets one
 * go once the values are in the props the view is committed with. Committing them changes nothing
 * on screen only if they land as Reanimated applied them: over everything else the view is given,
 * eased by nothing, and kept by every later commit until they are taken away.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  Engine,
  registerPlatformComponents,
  scrollsOverflow,
  type EngineNode,
  type StyleSheet,
} from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';
import { createLaidOutFabric } from './laid-out-fabric.ts';
import { recorder } from './native-animated.ts';

function scene(css = '') {
  const fabric = createFakeFabric();
  const clock = { now: 0 };
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css) as StyleSheet,
    now: () => clock.now,
  });
  const box: EngineNode = engine.createElement('view');
  const plain: EngineNode = engine.createElement('view');
  engine.setClasses(box, 'c');
  engine.appendChild(engine.root, box);
  engine.appendChild(engine.root, plain);
  engine.commit();
  const committed = (index = 0) => fabric.committed[index]!.props;
  return { engine, fabric, box, plain, clock, committed };
}

it('commits them over a rule marked important, inline style and a component override', () => {
  const { engine, box, committed } = scene(`.c { opacity: 0.2 !important; width: 10px }`);
  engine.setProp(box, 'style', { opacity: 0.3 });
  engine.setProp(box, 'styleOverride', { opacity: 0.4 });
  engine.setUiThreadProps(box, { opacity: 0.9 });
  engine.commit();
  assert.equal(committed()['opacity'], 0.9);
  assert.equal(committed()['width'], 10, 'with the rest of what the node is given');
});

it('processes them as it processes a style, for native', () => {
  const { engine, box, plain, committed } = scene();
  engine.setUiThreadProps(box, { backgroundColor: 'rgba(255, 0, 0, 1)' });
  engine.setProp(plain, 'style', { backgroundColor: 'rgba(255, 0, 0, 1)' });
  engine.commit();
  assert.equal(committed()['backgroundColor'], committed(1)['backgroundColor']);
});

it('keeps them through a later commit of something else', () => {
  const { engine, box, committed } = scene(`.c { width: 10px }`);
  engine.setUiThreadProps(box, { transform: [{ translateX: 40 }] });
  engine.commit();
  engine.setProp(box, 'accessibilityLabel', 'moved');
  engine.setProp(box, 'style', { width: 20 });
  engine.commit();
  assert.deepEqual(committed()['transform'], [{ translateX: 40 }]);
  assert.equal(committed()['width'], 20);
});

it('takes them away with null, back to what the node is given', () => {
  const { engine, box, committed } = scene(`.c { opacity: 0.2 }`);
  engine.setUiThreadProps(box, { opacity: 0.9, transform: [{ translateX: 40 }] });
  engine.commit();
  engine.setUiThreadProps(box, null);
  engine.commit();
  assert.equal(committed()['opacity'], 0.2);
  assert.equal(committed()['transform'] ?? null, null, 'and a prop only they set is removed');
});

it('follows a replacement that leaves a prop out', () => {
  const { engine, box, committed } = scene();
  engine.setUiThreadProps(box, { opacity: 0.5, transform: [{ translateX: 40 }] });
  engine.commit();
  engine.setUiThreadProps(box, { opacity: 0.6 });
  engine.commit();
  assert.equal(committed()['opacity'], 0.6);
  assert.equal(committed()['transform'] ?? null, null);
});

it('starts no transition: the view is already drawn at them', () => {
  const { engine, box, committed } = scene(`.c { opacity: 1; transition: opacity 200ms linear }`);
  engine.setUiThreadProps(box, { opacity: 0 });
  engine.commit();
  assert.equal(committed()['opacity'], 0);
  assert.equal(engine.animating, false);
});

it('commits nothing for the same props set again', () => {
  const { engine, fabric, box } = scene();
  const props = { opacity: 0.5 };
  engine.setUiThreadProps(box, props);
  engine.commit();
  const commits = fabric.calls.completeRoot;
  engine.setUiThreadProps(box, props);
  engine.setUiThreadProps(engine.createElement('view'), null);
  engine.commit();
  assert.equal(fabric.calls.completeRoot, commits);
});

/**
 * An element committed as two views, a scroll view and its content or an element and its wrapper,
 * splits its props between them by key. Reanimated drew on the outer view, the one its tag names,
 * so what it settled on goes there whatever the key, and the inner view keeps the element's own.
 */
function split(css: string, wrap: boolean) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(css) as StyleSheet });
  const box: EngineNode = engine.createElement('view');
  engine.setClasses(box, 'c');
  if (wrap) engine.wrapChildren(box, { viewName: 'RCTView', props: {} });
  else scrollsOverflow(box);
  engine.appendChild(box, engine.createElement('view'));
  engine.appendChild(engine.root, box);
  const outer = () => fabric.committed[0]!;
  const inner = () => outer().children[0]!;
  return { engine, fabric, box, outer, inner };
}

for (const [name, css, key, ownKey, own, drawn, wrap] of [
  [
    'a scroll view',
    `.c { overflow: scroll; height: 50px; padding: 4px }`,
    'padding',
    'paddingTop',
    4,
    10,
    false,
  ],
  [
    'a wrapped element',
    `.c { align-items: flex-start }`,
    'alignItems',
    'alignItems',
    'flex-start',
    'center',
    true,
  ],
] as const) {
  describe(`on ${name}`, () => {
    it('commits them on the outer view, from its first commit', () => {
      const { engine, box, outer, inner } = split(css, wrap);
      engine.setUiThreadProps(box, { [key]: drawn });
      engine.commit();
      assert.equal(outer().props[key], drawn);
      assert.equal(inner().props[ownKey], own, 'and the inner view keeps the element its own');
      assert.notEqual(inner().props[key], drawn, 'nor takes them itself');
      engine.setUiThreadProps(box, null);
      engine.commit();
      assert.equal(outer().props[key] ?? null, null, 'and taken away from its first commit too');
    });

    it('commits them on the outer view once set, and takes them away again', () => {
      const { engine, box, outer, inner } = split(css, wrap);
      engine.commit();
      engine.setUiThreadProps(box, { [key]: drawn, opacity: 0.5 });
      engine.commit();
      assert.equal(outer().props[key], drawn);
      assert.equal(outer().props['opacity'], 0.5);
      assert.equal(inner().props[ownKey], own);
      assert.notEqual(inner().props[key], drawn);
      engine.setUiThreadProps(box, { opacity: 0.6 });
      engine.commit();
      assert.equal(outer().props[key] ?? null, null, 'a prop only they set on it is removed');
      assert.equal(outer().props['opacity'], 0.6);
      engine.setUiThreadProps(box, null);
      engine.commit();
      assert.equal(outer().props['opacity'] ?? null, null);
      assert.equal(inner().props[ownKey], own);
    });

    it('sends them again only when they change', () => {
      const { engine, box, fabric } = split(css, wrap);
      engine.setUiThreadProps(box, { [key]: drawn });
      engine.commit();
      const before = { ...fabric.calls };
      engine.setProp(box.childList![0]!, 'nativeID', 'child');
      engine.commit();
      assert.equal(fabric.calls.cloneWithChildrenAndProps, before.cloneWithChildrenAndProps);
    });

    it('keeps them over a later change to the same prop of its own', () => {
      const { engine, box, outer } = split(css, wrap);
      engine.setProp(box, 'style', { opacity: 0.2 });
      engine.setUiThreadProps(box, { opacity: 0.9 });
      engine.commit();
      engine.setProp(box, 'style', { opacity: 0.3 });
      engine.commit();
      assert.equal(outer().props['opacity'], 0.9);
      engine.setUiThreadProps(box, null);
      engine.commit();
      assert.equal(outer().props['opacity'], 0.3, 'and its own value is back once they go');
    });
  });
}

it('has native paint them on a wrapped element changed again and again, not its own value', () => {
  const rec = recorder();
  const fabric = createLaidOutFabric();
  let now = 0;
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(`.c { width: 200px; height: 10px; opacity: 0.2 }`) as StyleSheet,
    nativeAnimated: rec.native,
    now: () => now,
  });
  const box: EngineNode = engine.createElement('view');
  engine.setClasses(box, 'c');
  engine.wrapChildren(box, { viewName: 'RCTView', props: {} });
  engine.appendChild(box, engine.createElement('view'));
  engine.appendChild(engine.root, box);
  engine.commit();
  for (const opacity of [0.4, 0.6, 0.8]) {
    now += 50;
    engine.advanceAnimations();
    engine.setUiThreadProps(box, { opacity });
    engine.commit();
  }
  const painted = rec.painted(engine.tagOf(box)!)['opacity'];
  const shown = painted ?? fabric.committed[0]!.props['opacity'];
  assert.equal(shown, 0.8);
});

it('keeps them when native paints a wrapped element again after an unrelated commit', () => {
  const rec = recorder();
  const fabric = createLaidOutFabric();
  let now = 0;
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(`.c { width: 200px; height: 10px }`) as StyleSheet,
    nativeAnimated: rec.native,
    now: () => now,
  });
  const box: EngineNode = engine.createElement('view');
  engine.setClasses(box, 'c');
  engine.wrapChildren(box, { viewName: 'RCTView', props: {} });
  engine.appendChild(box, engine.createElement('view'));
  engine.appendChild(engine.root, box);
  engine.commit();
  for (const x of ['10%', '20%', '30%']) {
    now += 50;
    engine.advanceAnimations();
    engine.setUiThreadProps(box, { transform: [{ translateX: x }] });
    engine.commit();
  }
  now += 50;
  engine.setProp(box, 'accessibilityLabel', 'unrelated');
  engine.commit();
  const tag = engine.tagOf(box)!;
  const painted = rec.painted(tag)['transform'];
  assert.deepEqual(painted ?? fabric.committed[0]!.props['transform'], [{ translateX: 60 }]);
});

it('names a monospace generic as the platform reads it, as a style does', () => {
  try {
    for (const [platform, written, committedAs] of [
      ['ios', 'monospace', 'ui-monospace'],
      ['android', 'ui-monospace', 'monospace'],
    ] as const) {
      registerPlatformComponents(platform);
      const fabric = createFakeFabric();
      const engine = new Engine(fabric, 1, { globalStyles: compileCss('') as StyleSheet });
      const text: EngineNode = engine.createElement('text');
      engine.appendChild(engine.root, text);
      engine.setUiThreadProps(text, { fontFamily: written });
      engine.commit();
      assert.equal(fabric.committed[0]!.props['fontFamily'], committedAs, platform);
    }
  } finally {
    registerPlatformComponents('ios');
  }
});
