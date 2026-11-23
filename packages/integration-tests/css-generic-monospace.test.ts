/**
 * The monospace generics. Native keeps one family of a stack, so `ui-monospace` and `monospace`
 * have to name a monospaced face on their own. React Native on iOS draws `ui-monospace` in the
 * system's monospaced face (SF Mono), as Safari does, and `monospace` in the system font. React
 * Native on Android draws `monospace` in its monospaced face, and `ui-monospace` in the system
 * font. The engine commits each platform the one it reads. The desktop host reads both itself.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, describe, it } from 'node:test';
import { Engine, registerPlatformComponents, type EngineNode } from '@ng-native/fabric';
import { NativeRendererFactory } from '@ng-native/platform';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const CSS =
  '.ui { font-family: ui-monospace } .mono { font-family: monospace }' +
  ' .stack { font-family: ui-monospace, Menlo, monospace } .named { font-family: Menlo }' +
  ' .token { font-family: var(--mono) }';

/** The family each view, by its test id, is committed with on `platform`. */
function families(platform: string): Record<string, unknown> {
  registerPlatformComponents(platform);
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: compileCss(CSS, 'app.css') as never });
  const renderer = new NativeRendererFactory(engine).createRenderer(null, null);
  const add = (id: string, classes: string, element = 'text', parent = engine.root): EngineNode => {
    const node = renderer.createElement(element) as EngineNode;
    renderer.setAttribute(node, 'class', classes);
    renderer.setAttribute(node, 'testID', id);
    if (element === 'text') renderer.appendChild(node, renderer.createText('Words'));
    renderer.appendChild(parent, node);
    return node;
  };
  for (const id of ['ui', 'mono', 'stack', 'named']) add(id, id);
  renderer.setStyle(add('inline-ui', ''), 'font-family', 'ui-monospace');
  renderer.setStyle(add('inline-mono', ''), 'font-family', 'monospace');
  renderer.setStyle(add('token', 'token'), '--mono', 'ui-monospace');
  add('inherited', '', 'text', add('box', 'ui', 'view'));
  renderer.setStyle(add('field', 'mono', 'text-input'), 'font-family', 'monospace');
  engine.commit();
  const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...all(node.children)]);
  return Object.fromEntries(
    all(fabric.committed)
      .filter((node) => typeof node.props['testID'] === 'string')
      .map((node) => [node.props['testID'], node.props['fontFamily']]),
  );
}

/** The views whose family is one of the generics, by each way it can be set. */
const GENERIC = ['ui', 'mono', 'stack', 'inline-ui', 'inline-mono', 'token', 'inherited', 'field'];

describe('a monospace generic font family', () => {
  afterEach(() => registerPlatformComponents('ios'));

  it("is iOS's ui-monospace on iOS, which React Native draws in SF Mono", () => {
    const font = families('ios');
    for (const id of GENERIC) {
      assert.equal(font[id], 'ui-monospace', id);
    }
    assert.equal(font['named'], 'Menlo');
  });

  it("is Android's monospace on Android, which React Native draws in its monospaced face", () => {
    const font = families('android');
    for (const id of GENERIC) {
      assert.equal(font[id], 'monospace', id);
    }
    assert.equal(font['named'], 'Menlo');
  });

  it('is left as written on the desktop host, which reads both', () => {
    for (const platform of ['macos', 'linux']) {
      const font = families(platform);
      assert.equal(font['ui'], 'ui-monospace', platform);
      assert.equal(font['mono'], 'monospace', platform);
      assert.equal(font['inherited'], 'ui-monospace', platform);
    }
  });
});
