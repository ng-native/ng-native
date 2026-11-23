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
import { it } from 'node:test';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

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
