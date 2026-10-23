/**
 * A style or a custom property bound to text the app did not write, `[style.color]="theme.tint"`
 * with the theme from a server, is read as a value or left unset. It never throws: the binding
 * is set during change detection, where a throw skips the rest of the view's bindings on every
 * tick for as long as the text stays bound.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, tokenFromValue } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

/**
 * What a child commits with `custom` set on its parent and `bound` bound on the child to `style`,
 * before a height bound to `--w`, which must commit either way.
 */
function committed(style: string, bound: string, custom: Record<string, string> = {}) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss('.a { padding-top: 1px }', 'app.css') as never,
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });
  const parent = engine.createElement('view');
  engine.appendChild(engine.root, parent);
  const child = engine.createElement('view');
  engine.appendChild(parent, child);
  engine.setCustomProperty(parent, '--w', '10px');
  for (const [name, value] of Object.entries(custom)) engine.setCustomProperty(parent, name, value);
  engine.setBoundStyle(child, style, bound);
  engine.setBoundStyle(child, 'height', 'var(--w)');
  engine.commit();
  const props = fabric.committed[0]!.children[0]!.props;
  assert.equal(props['height'], 10, 'the binding after it');
  return props;
}

const nested = (open: string, inner: string, close: string, depth: number): string =>
  open.repeat(depth) + inner + close.repeat(depth);

describe('a bound style read from text the app did not write', () => {
  it('control: a relative colour is read', () =>
    assert.equal(committed('color', 'rgb(from red r g b)')['color'], 'rgb(255, 0, 0)'));

  it('control: a colour of channels in a token is read', () => {
    const channels = { '--c': '255 0 0', '--x': 'rgb(var(--c))' };
    assert.equal(committed('color', 'var(--x)', channels)['color'], 'rgb(255, 0, 0)');
  });

  it('is unset when it names a function after a property of every object', () => {
    assert.equal(committed('color', 'constructor(from red r g b)')['color'], undefined);
    const relative = { '--x': 'constructor(from red r g b)' };
    assert.equal(committed('color', 'var(--x)', relative)['color'], undefined);
    const channels = { '--c': '255 0 0', '--x': 'constructor(var(--c))' };
    assert.equal(committed('color', 'var(--x)', channels)['color'], undefined);
  });

  it('sends no weight for a word that is a property of every object', () => {
    const word = { '--x': 'constructor' };
    assert.equal(committed('fontWeight', 'var(--x)', word)['fontWeight'], undefined);
  });

  it('control: a calc() a few brackets deep is read', () => {
    const custom = { '--x': nested('calc(', '0.5', ')', 8) };
    assert.equal(committed('opacity', 'var(--x)', custom)['opacity'], 0.5);
  });

  it('reads more brackets side by side than may nest', () => {
    const sum = Array(40).fill('var(--h)').join(' + ');
    const custom = { '--h': '0.5', '--x': `calc((${sum}) / 40)` };
    assert.equal(committed('opacity', 'var(--x)', custom)['opacity'], 0.5);
  });

  it('is unset when its brackets nest thousands deep', () => {
    const deep = 3000;
    const mix = nested('color-mix(in srgb, ', 'red', ', blue)', deep);
    const cases: [string, string, Record<string, string>?][] = [
      ['opacity', 'var(--x)', { '--x': `calc(${nested('(', '1', ')', deep)})` }],
      ['opacity', 'var(--x)', { '--x': `calc(${nested('(', 'var(--h)', ')', deep)})`, '--h': '1' }],
      ['backgroundColor', mix],
      ['backgroundColor', 'var(--x)', { '--x': mix }],
      ['backgroundColor', 'var(--x)', { '--x': nested('rgb(from ', 'red', ' r g b)', deep) }],
      ['width', nested('var(--z, ', '1px', ')', deep)],
      ['width', 'var(--x)', { '--x': nested('var(--z, ', '1px', ')', deep) }],
    ];
    for (const [style, bound, custom] of cases) {
      const shown = `${style}: ${bound.slice(0, 30)}`;
      assert.equal(committed(style, bound, custom)[style], undefined, shown);
    }
  });

  it('reads colours nested in the fallbacks of others once each', () => {
    // A colour function that is no colour, for its `x`, was read again as part of a mix, and so
    // was each one in its fallback: twice as long for each, some 400ms at sixteen.
    let text = 'red';
    for (let i = 0; i < 16; i++) text = `rgb(var(--c, ${text}), x)`;
    const start = performance.now();
    tokenFromValue(text);
    const took = performance.now() - start;
    assert.ok(took < 100, `${Math.round(took)}ms`);
  });
});
