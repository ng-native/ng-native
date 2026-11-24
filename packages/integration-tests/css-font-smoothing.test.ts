/**
 * `-webkit-font-smoothing`. Chrome and Safari on a Mac draw text with Core Graphics' font
 * smoothing, which thickens it, unless the text is `antialiased` (smoothing off) or `none`
 * (antialiasing off as well). CSS inherits it, so an app sets it once at its root. iOS and Android
 * never smooth text, and Chrome reads the property only on a Mac, so only the macOS host draws it:
 * the engine commits it there, on a paragraph, and nowhere else.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, describe, it, mock } from 'node:test';
import {
  Engine,
  registerPlatformComponents,
  registerViewName,
  type EngineNode,
} from '@ng-native/fabric';
import { NativeRendererFactory } from '@ng-native/platform';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

function compiled(css: string): { declarations: unknown[]; warnings: string[] } {
  const warnings: string[] = [];
  const sheet = compileCss(css, 'app.css', { onUnsupported: (m: string) => warnings.push(m) });
  return {
    declarations: sheet.rules.map((rule: { declarations: unknown }) => rule.declarations),
    warnings,
  };
}

const CSS =
  '.app { -webkit-font-smoothing: antialiased } .auto { -webkit-font-smoothing: auto }' +
  ' .none { -webkit-font-smoothing: none }';

function scene(platform: string, css = '') {
  registerPlatformComponents(platform);
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(CSS + css, 'app.css') as never,
  });
  const renderer = new NativeRendererFactory(engine).createRenderer(null, null);
  const add = (id: string, classes: string, element = 'text', parent = engine.root): EngineNode => {
    const node = renderer.createElement(element) as EngineNode;
    renderer.setAttribute(node, 'class', classes);
    renderer.setAttribute(node, 'testID', id);
    if (element === 'text') renderer.appendChild(node, renderer.createText('Words'));
    renderer.appendChild(parent, node);
    return node;
  };
  const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
    nodes.flatMap((node) => [node, ...all(node.children)]);
  /** Each committed view's `fontSmoothing`, by test id, and whether any view without one has it. */
  const smoothing = () => {
    engine.commit();
    const nodes = all(fabric.committed);
    return {
      byId: Object.fromEntries(
        nodes
          .filter((node) => typeof node.props['testID'] === 'string')
          .map((node) => [node.props['testID'], node.props['fontSmoothing']]),
      ),
      anywhere: nodes.filter((node) => node.props['fontSmoothing'] != null).length,
    };
  };
  return { renderer, add, smoothing };
}

describe('-webkit-font-smoothing in a stylesheet', () => {
  it('compiles each keyword, on every platform, without a warning', () => {
    const { declarations, warnings } = compiled(
      '.a { -webkit-font-smoothing: antialiased } .b { -webkit-font-smoothing: none }' +
        ' .c { -webkit-font-smoothing: subpixel-antialiased } .d { -webkit-font-smoothing: auto }' +
        ' .e { -webkit-font-smoothing: Antialiased }',
    );
    assert.deepEqual(warnings, []);
    assert.deepEqual(declarations, [
      { fontSmoothing: 'antialiased' },
      { fontSmoothing: 'none' },
      { fontSmoothing: 'subpixel-antialiased' },
      { fontSmoothing: 'auto' },
      // A keyword in any case, as CSS reads one.
      { fontSmoothing: 'antialiased' },
    ]);
  });

  it('drops a value that is none of its keywords, with a warning', () => {
    const { declarations, warnings } = compiled('.a { -webkit-font-smoothing: grayscale }');
    assert.deepEqual(declarations, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /-webkit-font-smoothing/);
  });

  it('takes a token, inherit, initial and unset without a warning', () => {
    const { declarations, warnings } = compiled(
      '.a { -webkit-font-smoothing: var(--x) } .b { -webkit-font-smoothing: inherit }' +
        ' .c { -webkit-font-smoothing: Unset } .d { -webkit-font-smoothing: initial }',
    );
    assert.deepEqual(warnings, []);
    assert.deepEqual(declarations, [{}, {}, {}, { fontSmoothing: 'auto' }]);
  });

  it("leaves Firefox's -moz-osx-font-smoothing out without a warning, as Chrome does", () => {
    // Tailwind's antialiased and every reset write it beside the webkit property.
    const { declarations, warnings } = compiled(
      '.a { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale }',
    );
    assert.deepEqual(warnings, []);
    assert.deepEqual(declarations, [{ fontSmoothing: 'antialiased' }]);
  });
});

describe('-webkit-font-smoothing on the macOS host', () => {
  afterEach(() => registerPlatformComponents('ios'));

  it("is a paragraph's, inherited as CSS inherits it, and no other view's", () => {
    const s = scene('macos');
    const app = s.add('root', 'app', 'view');
    s.add('inherits', '', 'text', app);
    s.add('own', 'none', 'text', app);
    const box = s.add('box', 'auto', 'view', app);
    s.add('nested', '', 'text', box);
    const { byId, anywhere } = s.smoothing();
    assert.equal(byId['inherits'], 'antialiased');
    assert.equal(byId['own'], 'none');
    assert.equal(byId['nested'], 'auto');
    assert.equal(byId['root'], undefined);
    assert.equal(byId['box'], undefined);
    assert.equal(anywhere, 3);
  });

  it('is set and removed by an inline style, as by a rule', () => {
    const s = scene('macos');
    const label = s.add('label', '');
    s.renderer.setStyle(label, '-webkit-font-smoothing', 'antialiased');
    assert.equal(s.smoothing().byId['label'], 'antialiased');
    s.renderer.removeStyle(label, '-webkit-font-smoothing');
    assert.equal(s.smoothing().byId['label'], null);
    s.renderer.setStyle(label, '-webkit-font-smoothing', 'None');
    assert.equal(s.smoothing().byId['label'], 'none');
  });

  it('keeps an inline value set before one with a no-break space, which is no keyword', (t) => {
    const warn = mock.method(console, 'warn', () => {});
    t.after(() => warn.mock.restore());
    const s = scene('macos');
    const app = s.add('root', 'app', 'view');
    const label = s.add('label', '', 'text', app);
    s.renderer.setStyle(label, '-webkit-font-smoothing', 'none');
    for (const value of ['\u00a0inherit', 'unset\u00a0', '\u00a0antialiased', 'auto\u00a0']) {
      s.renderer.setStyle(label, '-webkit-font-smoothing', value);
      assert.equal(s.smoothing().byId['label'], 'none', value);
    }
    s.renderer.setStyle(label, '-webkit-font-smoothing', '\tauto ');
    assert.equal(s.smoothing().byId['label'], 'auto');
  });

  it("is auto for a token's fallback of initial, and the parent's for a token set to initial", () => {
    const s = scene(
      'macos',
      ' .fallback { -webkit-font-smoothing: var(--missing, initial) }' +
        ' .initial { --s: initial; -webkit-font-smoothing: var(--s) }' +
        ' .inherit { -webkit-font-smoothing: var(--missing, inherit) }',
    );
    const app = s.add('root', 'app', 'view');
    s.add('fallback', 'fallback', 'text', app);
    s.add('initial', 'initial', 'text', app);
    s.add('inherit', 'inherit', 'text', app);
    const { byId } = s.smoothing();
    assert.equal(byId['fallback'], 'auto');
    assert.equal(byId['initial'], 'antialiased');
    assert.equal(byId['inherit'], 'antialiased');
  });

  it("is auto for a fallback of initial set on the element, and the parent's for a token of it", () => {
    const s = scene('macos');
    const app = s.add('root', 'app', 'view');
    const fallback = s.add('fallback', '', 'text', app);
    const token = s.add('token', '', 'text', app);
    s.renderer.setStyle(fallback, '-webkit-font-smoothing', 'var(--missing, initial)');
    s.renderer.setStyle(token, '--s', 'initial');
    s.renderer.setStyle(token, '-webkit-font-smoothing', 'var(--s)');
    const { byId } = s.smoothing();
    assert.equal(byId['fallback'], 'auto');
    assert.equal(byId['token'], 'antialiased');
  });

  it("is a text input's, inherited as a paragraph's is", () => {
    const s = scene('macos');
    const app = s.add('root', 'app', 'view');
    s.add('field', '', 'text-input', app);
    s.add('own', 'none', 'text-input', app);
    const { byId } = s.smoothing();
    assert.equal(byId['field'], 'antialiased');
    assert.equal(byId['own'], 'none');
  });

  it('is the view of a registration that says it draws it, and of no other', () => {
    const drawn = registerViewName('smooth-field', 'SmoothField', undefined, {
      fontSmoothing: true,
    });
    const carried = registerViewName('plain-field', 'PlainField');
    try {
      const s = scene('macos');
      const app = s.add('root', 'app', 'view');
      s.add('drawn', '', 'smooth-field', app);
      s.add('carried', '', 'plain-field', app);
      const { byId } = s.smoothing();
      assert.equal(byId['drawn'], 'antialiased');
      assert.equal(byId['carried'], undefined);
    } finally {
      drawn();
      carried();
    }
  });

  it('is no longer the view of a registration that says nothing of it, once it is replaced', () => {
    const first = registerViewName('smooth-field', 'SmoothField', undefined, {
      fontSmoothing: true,
    });
    const second = registerViewName('smooth-field', 'SmoothField');
    try {
      const s = scene('macos');
      s.add('field', '', 'smooth-field', s.add('root', 'app', 'view'));
      assert.equal(s.smoothing().byId['field'], undefined);
    } finally {
      second();
      first();
    }
  });

  it('goes back to the default when the class that set it is removed', () => {
    const s = scene('macos');
    const app = s.add('root', 'app', 'view');
    s.add('label', '', 'text', app);
    assert.equal(s.smoothing().byId['label'], 'antialiased');
    s.renderer.removeClass(app, 'app');
    assert.equal(s.smoothing().byId['label'], null);
  });
});

describe('-webkit-font-smoothing elsewhere', () => {
  afterEach(() => registerPlatformComponents('ios'));

  for (const platform of ['ios', 'android', 'linux']) {
    it(`commits nothing on ${platform}, which draws no smoothing to turn off`, () => {
      const s = scene(platform);
      const app = s.add('root', 'app', 'view');
      s.add('label', '', 'text', app);
      s.renderer.setStyle(s.add('inline', ''), '-webkit-font-smoothing', 'antialiased');
      assert.equal(s.smoothing().anywhere, 0);
    });
  }
});
