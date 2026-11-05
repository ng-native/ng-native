/**
 * `Engine.token` and `Engine.watchToken`: a custom property's value read from TypeScript, as the
 * cascade settles it, for a prop, a drawing or an API that takes a colour rather than a style.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, HostEngine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';
import { createLaidOutFabric } from './laid-out-fabric.ts';
import { recorder } from './native-animated.ts';

const CSS =
  ':root { --brand: #ff0000; --accent: var(--brand); --soft: color-mix(in srgb, var(--accent) 50%, white);' +
  ' --fallen: var(--nowhere, #00ff00); --gap: 12px; --label: bold }' +
  ' @media (prefers-color-scheme: dark) { :root { --brand: #0000ff } }' +
  ' .local { --accent: #123456; --only: 3px } .plain { color: red }';

function scene(onError?: (error: unknown, type: string) => void) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(CSS, 'app.css') as never,
    conditions: { width: 400, height: 800, colorScheme: 'light' },
    onError,
  });
  const node = engine.createElement('view');
  engine.appendChild(engine.root, node);
  const scheme = (colorScheme: 'light' | 'dark') =>
    engine.updateConditions({ width: 400, height: 800, colorScheme });
  return { engine, fabric, node, scheme };
}

describe('a token read from TypeScript', () => {
  it('is the value the root resolves it to, through aliases, mixes and fallbacks', () => {
    const { engine } = scene();
    engine.commit();
    assert.equal(engine.token('--brand'), 'rgb(255, 0, 0)');
    assert.equal(engine.token('--accent'), 'rgb(255, 0, 0)');
    assert.equal(engine.token('--soft'), 'rgb(255, 128, 128)');
    assert.equal(engine.token('--fallen'), 'rgb(0, 255, 0)');
    assert.equal(engine.token('--gap'), '12px');
    assert.equal(engine.token('--label'), 'bold');
    assert.equal(engine.token('--undefined'), undefined);
  });

  it('is known before the first commit, as a component built in it reads it', () => {
    const { engine, fabric } = scene();
    assert.equal(engine.token('--accent'), 'rgb(255, 0, 0)');
    assert.equal(fabric.committed.length, 0, 'reading it commits nothing');
    engine.commit();
    assert.equal(fabric.committed.length, 1, 'and the commit after it still sends the tree');
  });

  it('writes an angle, a time and a list of lengths as CSS writes them', () => {
    const { engine } = scene();
    engine.updateTokens({
      '--turn': { angle: 90 },
      '--quick': { time: 200 },
      '--pad': { lengths: [4, '10%'] },
    });
    assert.equal(engine.token('--turn'), '90deg');
    assert.equal(engine.token('--quick'), '200ms');
    assert.equal(engine.token('--pad'), '4px 10%');
  });

  it('is undefined from a host that keeps no tokens, and never reported', () => {
    class Bare extends HostEngine {
      setProp() {}
      setEventListener = () => () => {};
      setResponder = () => () => {};
      measure() {}
      dispatchCommand() {}
      commit = () => false;
      focused = null;
      focusedField = null;
      blurFocused() {}
      resolveAsset = (value: unknown) => value;
      color = (value: unknown) => value;
    }
    const host = new Bare();
    assert.equal(host.token('--accent'), undefined);
    assert.doesNotThrow(host.watchToken('--accent', () => assert.fail('reported')));
  });

  it('follows the colour scheme, before a commit as after one', () => {
    const { engine, scheme } = scene();
    engine.commit();
    scheme('dark');
    assert.equal(engine.token('--accent'), 'rgb(0, 0, 255)');
    assert.equal(engine.token('--soft'), 'rgb(128, 128, 255)');
    scheme('light');
    assert.equal(engine.token('--accent'), 'rgb(255, 0, 0)');
  });

  it('follows a sheet added since the last commit, before the next one', () => {
    const { engine } = scene();
    engine.commit();
    assert.equal(engine.token('--accent'), 'rgb(255, 0, 0)');
    engine.addGlobalSheet(compileCss(':root { --accent: #00ff00 }', 'late.css') as never);
    assert.equal(engine.token('--accent'), 'rgb(0, 255, 0)');
  });

  it('names a platform colour as `platform-color()`, its names quoted as the CSSOM quotes them', () => {
    const { engine } = scene();
    engine.updateTokens({ '--os': { color: { platformColor: ['label', 'a"b\nc\u0000'] } } });
    assert.equal(engine.token('--os'), 'platform-color(label, "a\\"b\\a c\uFFFD")');
  });

  it('includes the tokens the host supplies, and a :root rule over one of them', () => {
    const { engine } = scene();
    engine.updateTokens({ '--inset-top': { length: 47 } });
    assert.equal(engine.token('--inset-top'), '47px');
    engine.updateTokens({ '--brand': { color: '#00ff00' } });
    assert.equal(engine.token('--brand'), 'rgb(255, 0, 0)', 'the sheet’s :root wins');
  });

  it('is the value in scope at a node, once the node has been committed', () => {
    const { engine, node } = scene();
    engine.setClasses(node, 'local');
    assert.equal(engine.token('--accent', node), undefined, 'not styled yet');
    engine.commit();
    assert.equal(engine.token('--accent', node), 'rgb(18, 52, 86)');
    assert.equal(engine.token('--accent'), 'rgb(255, 0, 0)', 'the root keeps its own');
  });
});

describe('a token watched from TypeScript', () => {
  function watching(name: string, node?: EngineNode) {
    const s = scene();
    const heard: (string | undefined)[] = [];
    const stop = s.engine.watchToken(name, (value) => heard.push(value), node ?? s.node);
    return { ...s, heard, stop };
  }

  it('is reported after each commit that changes it, and not after one that does not', () => {
    const { engine, node, heard, scheme } = watching('--accent');
    engine.commit();
    assert.deepEqual(heard, ['rgb(255, 0, 0)'], 'its first value, once the node has one');
    engine.setClasses(node, 'plain');
    engine.commit();
    assert.deepEqual(heard, ['rgb(255, 0, 0)'], 'a change to something else');
    scheme('dark');
    assert.deepEqual(heard, ['rgb(255, 0, 0)', 'rgb(0, 0, 255)']);
  });

  it('is reported at a node deep under the one whose class changes it', () => {
    const { engine, node } = scene();
    const middle = engine.createElement('view');
    const deep = engine.createElement('view');
    engine.appendChild(node, middle);
    engine.appendChild(middle, deep);
    engine.commit();
    const heard: (string | undefined)[] = [];
    engine.watchToken('--accent', (value) => heard.push(value), deep);
    engine.setClasses(node, 'local');
    engine.commit();
    engine.setClasses(node, '');
    engine.commit();
    assert.deepEqual(heard, ['rgb(18, 52, 86)', 'rgb(255, 0, 0)']);
  });

  it('is reported at the root without a node, from the value `token` already gave', () => {
    const s = scene();
    const heard: (string | undefined)[] = [];
    s.engine.watchToken('--accent', (value) => heard.push(value));
    s.engine.commit();
    assert.deepEqual(heard, [], 'the root had its value before the commit');
    s.scheme('dark');
    assert.deepEqual(heard, ['rgb(0, 0, 255)']);
  });

  it('is reported as undefined once nothing defines it', () => {
    const { engine, node, heard } = watching('--accent');
    engine.setClasses(node, 'local');
    engine.commit();
    engine.setClasses(node, '');
    engine.commit();
    assert.deepEqual(heard, ['rgb(18, 52, 86)', 'rgb(255, 0, 0)'], 'back to the root’s');
    const gone = watching('--only');
    gone.engine.setClasses(gone.node, 'local');
    gone.engine.commit();
    gone.engine.setClasses(gone.node, '');
    gone.engine.commit();
    assert.deepEqual(gone.heard, ['3px', undefined]);
  });

  it('stops when told to', () => {
    const { engine, heard, scheme, stop } = watching('--accent');
    engine.commit();
    stop();
    scheme('dark');
    assert.deepEqual(heard, ['rgb(255, 0, 0)']);
  });

  it('reports a listener that throws and still reports to the rest', () => {
    const errors: unknown[] = [];
    const { engine, node, scheme } = scene((error) => errors.push(error));
    const heard: (string | undefined)[] = [];
    engine.watchToken(
      '--accent',
      () => {
        throw new Error('listener');
      },
      node,
    );
    engine.watchToken('--accent', (value) => heard.push(value), node);
    engine.commit();
    scheme('dark');
    assert.equal(errors.length, 2);
    assert.deepEqual(heard, ['rgb(255, 0, 0)', 'rgb(0, 0, 255)']);
  });

  it('is reported after a change native paints in place of a commit', () => {
    const rec = recorder();
    let now = 0;
    const fabric = createLaidOutFabric();
    const sheet = '.bar { width: 200px; height: 10px; background-color: var(--tint, red) }';
    const engine = new Engine(fabric, 1, {
      globalStyles: compileCss(sheet) as StyleSheet,
      nativeAnimated: rec.native,
      now: () => now,
    });
    const view = engine.createElement('view');
    engine.setClasses(view, 'bar');
    engine.appendChild(engine.root, view);
    engine.commit();
    const heard: (string | undefined)[] = [];
    engine.watchToken('--tint', (value) => heard.push(value), view);
    const tints = ['#000001', '#000002', '#000003'];
    // Stepped as a timer steps it: from the second change on, native paints it with no commit.
    for (const tint of tints) {
      now += 50;
      engine.advanceAnimations();
      engine.setCustomProperty(view, '--tint', tint);
      engine.commit();
    }
    assert.equal(fabric.calls.completeRoot, 3, 'the last change was painted, not committed');
    assert.deepEqual(heard, tints);
  });
});
