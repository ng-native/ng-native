/**
 * A change inside a box out of the flow with a width and a height of its own: a progress bar's
 * indicator, in a track placed at a size of its own. Yoga lays such a box out at the size it is given, and
 * nothing in it moves anything outside it, so the engine reads back no box around it to see
 * whether what it lays out in Yoga's place has to be laid out again. A progress bar ticks on a
 * timer for as long as its page is open, and each tick was reading the whole page's layout.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import {
  Engine,
  registerHoist,
  type EngineNode,
  type FabricNode,
  type FabricUIManager,
} from '@ng-native/fabric';
import { createLaidOutFabric } from './laid-out-fabric.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const CSS = `
  .page { display: block; width: 400px }
  .chip { display: inline-flex; flex-direction: row; height: 32px }
  .cell { width: 100%; display: flex; flex-direction: row }
  .other { width: 100% }
  .held { position: absolute; left: 0; top: 40px; width: 200px; height: 40px }
  .track { position: relative; height: 12px; width: 100% }
  .bar { height: 100%; width: 10% }
  .half { width: 50% }
  .box { display: block; position: absolute; left: 0; top: 0; width: 300px; height: 100px }
  .row { display: flex; flex-direction: row; width: 300px }
  .block { display: block; flex: 1 }
  .cols { width: calc(50% - 5px) }
  .narrow { width: 150px }
`;

type Spec = [name: string, ...children: Spec[]];

/** `tags` names the element a node is, where it is not a view. */
function scene(spec: Spec, tags: Record<string, string> = {}) {
  const fabric = createLaidOutFabric();
  const read: string[] = [];
  const rect = (fabric as FabricUIManager).getBoundingClientRect!;
  (fabric as FabricUIManager).getBoundingClientRect = (handle: FabricNode, ...rest) => {
    read.push(String((handle as unknown as { props: Record<string, unknown> }).props['nativeID']));
    return rect(handle, ...rest);
  };
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(CSS, 'app.css') as never });
  const nodes = new Map<string, EngineNode>();
  const build = ([name, ...children]: Spec, parent: EngineNode): void => {
    const node = engine.createElement(tags[name] ?? 'view');
    engine.setClasses(node, name.split('#')[0]!);
    engine.setProp(node, 'nativeID', name);
    engine.appendChild(parent, node);
    nodes.set(name, node);
    for (const child of children) build(child, node);
  };
  build(spec, engine.root);
  const say = (name: string, words: string) => {
    const text = engine.createElement('text');
    engine.setProp(text, 'nativeID', `${name} text`);
    const run = engine.createText(words);
    engine.appendChild(text, run);
    engine.appendChild(nodes.get(name)!, text);
    return run;
  };
  /** Commit, and answer the boxes read back for it. */
  const commit = () => {
    read.length = 0;
    engine.commit();
    return [...read];
  };
  return { engine, fabric, nodes, say, commit, read };
}

const PAGE: Spec = [
  'page',
  ['chip', ['cell']],
  ['chip#other', ['other a'], ['other b']],
  ['held#progress', ['label'], ['track', ['bar']]],
];

describe('a change inside a box out of the flow with a size of its own', () => {
  it('reads back no box outside it', () => {
    const s = scene(PAGE);
    s.say('cell', 'One fish');
    s.say('label', 'Loading');
    s.commit();
    assert.equal(s.fabric.box('chip').width, 80);
    assert.equal(s.fabric.box('bar').width, 20);
    s.engine.setClasses(s.nodes.get('bar')!, 'bar half');
    // What a screen reader is told of the bar changes with it, and moves no box.
    s.engine.setProp(s.nodes.get('held#progress')!, 'accessibilityValue', { now: 50 });
    const read = s.commit();
    assert.equal(s.fabric.box('bar').width, 100);
    const outside = ['page', 'chip', 'cell', 'chip#other', 'other a', 'other b'];
    assert.deepEqual(
      read.filter((name) => outside.includes(name)),
      [],
    );
  });

  it('reads back no box outside it where the change is in a group hoisted into the box itself', () => {
    // A canvas commits only the group it draws in, hoisted into it as its one child.
    const undo = registerHoist('held-layer', 'held-canvas', { only: true });
    try {
      const s = scene(
        ['page', ['chip', ['cell']], ['held#progress', ['layer', ['track', ['bar']]]]],
        { 'held#progress': 'held-canvas', layer: 'held-layer' },
      );
      s.say('cell', 'One fish');
      s.commit();
      s.engine.setClasses(s.nodes.get('bar')!, 'bar half');
      const read = s.commit();
      assert.equal(s.fabric.box('bar').width, 100);
      assert.deepEqual(
        read.filter((name) => ['page', 'chip', 'cell'].includes(name)),
        [],
      );
    } finally {
      undo();
    }
  });

  it('still lays out again what is inside it', () => {
    // A share of the room less points beside words in a row inside the held box: of the room the
    // words leave it, which changed with nothing about the box itself.
    const laidOut = (words: string) => {
      const s = scene([
        'page',
        ['box', ['row', ['label'], ['block', ['cols']]]],
        ['chip#other', ['other a']],
      ]);
      const label = s.say('label', words);
      const width = () => (s.commit(), s.fabric.box('cols').width);
      return { ...s, label, width };
    };
    const s = laidOut('A');
    const first = s.width();
    s.engine.setText(s.label, 'Many more words');
    assert.equal(s.width(), laidOut('Many more words').width());
    assert.ok(s.width() < first);
  });

  it('reads the page again where a change is not held, a box went or the conditions changed', () => {
    const s = scene(PAGE);
    s.say('cell', 'One fish');
    s.say('label', 'Loading');
    s.commit();
    s.say('other a', 'Two');
    assert.ok(s.commit().includes('chip#other'));
    s.engine.removeChild(s.nodes.get('track')!, s.nodes.get('bar')!);
    assert.ok(s.commit().includes('page'));
    s.engine.appendChild(s.nodes.get('track')!, s.nodes.get('bar')!);
    s.commit();
    // A change of conditions can move every box, whatever else changed with it.
    s.engine.setClasses(s.nodes.get('bar')!, 'bar half');
    s.read.length = 0;
    s.engine.updateConditions({ width: 400, height: 800, colorScheme: 'light' });
    assert.ok(s.read.includes('chip#other'));
  });
});
