/**
 * Animations native plays that end in the same frame. Each end marks its view and leaves the
 * commit to the host, which commits once a frame, rather than committing the whole tree for each
 * of them: a list of labels fading in together ends with one commit, not one a label.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';
import { recorder } from './native-animated.ts';

const CSS = `
  @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
  @keyframes out { from { opacity: 1 } to { opacity: 0 } }
  .in { animation: fade 220ms linear both }
  .leaves { animation: out 200ms linear }
  .shown { opacity: 1 }
`;

function scene(classes: string, count: number, host: boolean) {
  const rec = recorder();
  const fabric = createFakeFabric();
  fabric.frames.set('View', { x: 0, y: 0, width: 200, height: 100 });
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(CSS) as StyleSheet,
    nativeAnimated: rec.native,
    now: () => 0,
  });
  let dirtied = 0;
  if (host) engine.setOnDirty(() => void dirtied++);
  const views = Array.from({ length: count }, () => {
    const view = engine.createElement('view');
    engine.setClasses(view, classes);
    engine.appendChild(engine.root, view);
    return view;
  });
  engine.commit();
  dirtied = 0;
  const finishAll = () => {
    for (const [, id] of rec.named('start')) rec.finish(id as number);
  };
  /** What native was last set to on each view, once no animation drives it. */
  const set = () => views.map((view) => rec.painted(engine.tagOf(view)));
  const opacities = () => fabric.committed.map((node) => node.props['opacity']);
  return { engine, rec, views, finishAll, set, opacities, dirtied: () => dirtied };
}

describe('native animations that end together', () => {
  it('share one commit the host asks for, rather than one each', () => {
    const s = scene('in', 40, true);
    assert.equal(s.engine.animating, false, 'all of them played on native');
    const commits = s.engine.stats.commits;
    s.finishAll();
    assert.equal(s.engine.stats.commits, commits, 'no commit as each ends');
    assert.equal(s.dirtied(), 1, 'the host is asked for one frame');
    assert.ok(s.engine.pending);
    s.engine.commit();
    assert.equal(s.engine.stats.commits, commits + 1);
    assert.deepEqual(s.opacities(), Array(40).fill(1), 'each at the frame it fills with');
  });

  it('have the style each rests at set on native once that commit is made', () => {
    // Where they rest is the frame they were committed at as they played, which the commit does
    // not change, and native has drawn them elsewhere since.
    const s = scene('shown leaves', 3, true);
    s.finishAll();
    assert.deepEqual(s.set(), [{}, {}, {}], 'nothing set before the commit');
    s.engine.commit();
    assert.deepEqual(s.set(), Array(3).fill({ opacity: 1 }));
    const sets = s.rec.named('set').length;
    s.engine.commit();
    assert.equal(s.rec.named('set').length, sets, 'and set once, not again by a later commit');
  });

  it('set nothing on a view removed before that commit', () => {
    const s = scene('shown leaves', 2, true);
    s.finishAll();
    s.engine.removeChild(s.engine.root, s.views[0]!);
    const sets = s.rec.named('set').length;
    s.engine.commit();
    assert.deepEqual(s.set()[1], { opacity: 1 });
    assert.equal(s.rec.named('set').length, sets + 1, 'only the view still there');
  });

  it('commit as each ends where no host commits for them', () => {
    const s = scene('shown leaves', 2, false);
    const commits = s.engine.stats.commits;
    s.finishAll();
    assert.equal(s.engine.stats.commits, commits + 2);
    assert.deepEqual(s.set(), Array(2).fill({ opacity: 1 }));
  });
});
