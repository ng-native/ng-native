import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');
const { flattenTailwind } = require('@ng-native/tailwind') as {
  flattenTailwind(css: string): string;
};
const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

function scene(css: string) {
  const reports: string[] = [];
  const sheet = compileCss(flattenTailwind(css), 'app.css', {
    onUnsupported: (m: string) => reports.push(m),
  });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  const theme = engine.createElement('view');
  engine.setClasses(theme, 'theme');
  engine.appendChild(engine.root, theme);
  const add = (name: string, classes: string) => {
    const node = engine.createElement(name);
    engine.setClasses(node, classes);
    engine.appendChild(theme, node);
  };
  return {
    reports,
    add,
    props: () => {
      engine.commit();
      return flatten(fabric.committed).map((node) => node.props);
    },
  };
}

const colourOf = (value: string): unknown => {
  const s = scene(`.c { color: ${value} }`);
  s.add('text', 'c');
  return s.props().find((props) => 'color' in props)?.['color'];
};

const placeholderOf = (css: string, classes = 'f'): unknown => {
  const s = scene(css);
  s.add('text-input', classes);
  return s.props().find((props) => 'placeholderTextColor' in props)?.['placeholderTextColor'];
};

describe('::placeholder, as the text input placeholder colour', () => {
  it('reads a colour as the placeholder colour, as a browser paints it', () => {
    assert.equal(
      placeholderOf('.f::placeholder { color: rebeccapurple }'),
      colourOf('rebeccapurple'),
    );
  });

  it('reads a token, from the element or an ancestor', () => {
    assert.equal(
      placeholderOf('.theme { --muted: #00ff00 } .f::placeholder { color: var(--muted) }'),
      colourOf('#00ff00'),
    );
    assert.equal(
      placeholderOf('.f { --muted: #0000ff } .f::placeholder { color: var(--muted) }'),
      colourOf('#0000ff'),
    );
  });

  it('reads Tailwind 3, whose colour reads an opacity token set beside it', () => {
    const v3 =
      '.placeholder-red-500::placeholder { --tw-placeholder-opacity: 1; ' +
      'color: rgb(239 68 68 / var(--tw-placeholder-opacity)) }';
    assert.equal(placeholderOf(v3, 'placeholder-red-500'), colourOf('rgb(239 68 68)'));
  });

  it("leaves the input's own text colour alone", () => {
    const s = scene('.f { color: red } .f::placeholder { color: blue }');
    s.add('text-input', 'f');
    const input = s.props().find((props) => 'placeholderTextColor' in props)!;
    assert.equal(input['color'], colourOf('red'));
    assert.equal(input['placeholderTextColor'], colourOf('blue'));
  });

  it('keeps the other selectors of a list it shares', () => {
    const s = scene('.a, .f::placeholder { color: red }');
    s.add('text', 'a');
    s.add('text-input', 'f');
    const props = s.props();
    assert.ok(props.some((p) => p['color'] === colourOf('red') && !('placeholderTextColor' in p)));
    assert.ok(props.some((p) => p['placeholderTextColor'] === colourOf('red')));
  });

  it('reports what a placeholder cannot take, and keeps its colour', () => {
    const s = scene('.f::placeholder { color: red; font-style: italic }');
    s.add('text-input', 'f');
    const input = s.props().find((props) => 'placeholderTextColor' in props);
    assert.equal(input?.['placeholderTextColor'], colourOf('red'));
    assert.equal(input?.['fontStyle'], undefined);
    assert.equal(s.reports.length, 1);
    assert.match(s.reports[0]!, /font-style/);
  });

  it('applies to a text input only, where a browser has a placeholder', () => {
    const s = scene('.f::placeholder { color: red } view::placeholder { color: blue }');
    s.add('view', 'f');
    s.add('text-input', 'f');
    const props = s.props();
    assert.equal(props.filter((p) => 'placeholderTextColor' in p).length, 1);
  });

  it('still refuses every other pseudo-element', () => {
    const s = scene('.f::before { color: red }');
    assert.equal(s.reports.length, 1);
    assert.match(s.reports[0]!, /pseudo-element/);
  });

  it('keeps a rule whole when a pseudo-element rule is nested after its declarations', () => {
    // What Tailwind emits for `@apply transition-[color,box-shadow] file:font-medium`. The comma
    // in the declaration is not one between selectors, and the build failed on what was left.
    const s = scene(`.f {
      transition-property: color,box-shadow;
      opacity: 0.5;
      &::file-selector-button {
        font-weight: 500;
      }
    }`);
    s.add('view', 'f');
    assert.equal(s.props().find((props) => 'opacity' in props)?.['opacity'], 0.5);
    assert.equal(s.reports.filter((report) => /pseudo-element/.test(report)).length, 1);
  });

  it('still drops a pseudo-element from a nested list that has other selectors', () => {
    const s = scene(`.f {
      opacity: 0.5;
      &[data-on="a,b"], &::before {
        opacity: 1;
      }
    }`);
    s.add('view', 'f');
    assert.equal(s.props().find((props) => 'opacity' in props)?.['opacity'], 0.5);
    assert.deepEqual(s.reports, []);
  });
});
