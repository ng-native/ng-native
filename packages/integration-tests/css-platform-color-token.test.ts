/**
 * A custom property holding a platform colour: `--accent: platform-color(link)`, read with
 * `var(--accent)`.
 *
 * Where the value lands as a whole colour, the token is the colour, and the element commits what
 * `color: platform-color(link)` written out commits. A colour only the platform resolves has no
 * channels for the build or the engine to work with, so where one is needed (a `color-mix()`, a
 * relative colour, a gradient, a shadow) the declaration is dropped, and said to be.
 *
 * There is no Chrome to compare with: a browser has no `platform-color()`. The reference is the
 * same declaration with the colour written in place of the `var()`.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { NativeRendererFactory } from '@ng-native/platform';
import { compileCss, createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

const LINK = 'platform-color(link, "?attr/colorAccent")';
/** What a committed platform colour is on iOS, through the `processColor` stand-in below. */
const PROCESSED_LINK = { processed: { semantic: ['link', '?attr/colorAccent'] } };

const EMULATED = 0;
const NONE = 2;

/**
 * An engine with `globalCss`, and elements made in it, in the tree, each wearing its classes.
 * In development, so what it says is heard.
 */
function app(globalCss: string) {
  let now = 1000;
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(globalCss, 'global.css') as StyleSheet,
    processColor: (value) => ({ processed: value }),
    dev: true,
    now: () => now,
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });
  const factory = new NativeRendererFactory(engine);
  const committed = (node: EngineNode) =>
    flatten(fabric.committed).find((one) => one.instanceHandle === node)!.props;
  return {
    engine,
    committed,
    element(classes: string, tag = 'view', parent: EngineNode = engine.root): EngineNode {
      const node = engine.createElement(tag);
      engine.setClasses(node, classes);
      engine.appendChild(parent, node);
      return node;
    },
    /** A component's host, with its sheet, and the element inside it whose props are read. */
    component(id: string, css: string, encapsulation = EMULATED, classes = 'inner') {
      const type = { ɵnativeStyles: compileCss(css, id) as StyleSheet };
      const make = () => {
        const host = engine.createElement('view');
        engine.appendChild(engine.root, host);
        const renderer = factory.createRenderer(host, { id, encapsulation, type } as never);
        const inner = renderer.createElement('view') as EngineNode;
        engine.setClasses(inner, classes);
        engine.appendChild(host, inner);
        return { host, inner };
      };
      let made = make();
      return {
        get inner() {
          return made.inner;
        },
        /** A hot swap to `next`, as Angular's HMR does it: the sheet changes, the views are made again. */
        swap(next: string): void {
          type.ɵnativeStyles = compileCss(next, id) as StyleSheet;
          factory.componentReplaced(id);
          engine.removeChild(engine.root, made.host);
          engine.destroyNode(made.host);
          made = make();
          engine.commit();
        },
      };
    },
    tick(ms: number): void {
      now += ms;
      engine.advanceAnimations();
      engine.commit();
    },
  };
}

/** The colour properties a token is read in, each as a declaration and the props it commits. */
const COLOUR_PROPERTIES = [
  'color',
  'background-color',
  'background',
  'border-top-color',
  'border-color',
  'border-inline-start-color',
  'outline-color',
  'text-decoration-color',
  'tint-color',
  'shadow-color',
];

const warnings: string[] = [];
const warn = console.warn;
before(() => {
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
});
after(() => {
  console.warn = warn;
});
afterEach(() => {
  warnings.length = 0;
});

describe('a token holding platform-color()', () => {
  it('compiles, where it was refused at its definition', () => {
    const dropped: string[] = [];
    const sheet = compileCss(`:root { --accent: ${LINK}; }`, 'tokens.css', {
      onUnsupported: (message) => dropped.push(message),
    });
    assert.deepEqual(dropped, []);
    assert.equal(sheet.rules.length, 1);
  });

  for (const property of COLOUR_PROPERTIES) {
    it(`commits in ${property} what the colour written there commits`, () => {
      const s = app(
        `:root { --accent: ${LINK}; } .direct { ${property}: ${LINK}; } .token { ${property}: var(--accent); }`,
      );
      const direct = s.element('direct');
      const token = s.element('token');
      s.engine.commit();
      const { nativeID: _d, ...expected } = s.committed(direct);
      const { nativeID: _t, ...actual } = s.committed(token);
      assert.ok(Object.keys(expected).length > 0, `${property} commits something written out`);
      assert.deepEqual(actual, expected);
    });
  }

  it('lands in each side of a border shorthand as a colour does', () => {
    const s = app(`:root { --accent: ${LINK}; } .a { border: 1px solid var(--accent); }`);
    const a = s.element('a');
    s.engine.commit();
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      assert.deepEqual(s.committed(a)[`border${side}Color`], PROCESSED_LINK, side);
    }
  });

  it('is read through another token, and as a fallback', () => {
    const s = app(
      `:root { --accent: ${LINK}; --alias: var(--accent); }` +
        ` .chain { color: var(--alias); } .fallback { color: var(--unset, ${LINK}); }` +
        ` .defined { color: var(--accent, red); }`,
    );
    const chain = s.element('chain');
    const fallback = s.element('fallback');
    const defined = s.element('defined');
    s.engine.commit();
    assert.deepEqual(s.committed(chain)['color'], PROCESSED_LINK);
    assert.deepEqual(s.committed(fallback)['color'], PROCESSED_LINK);
    // The token is set, so CSS substitutes it and never looks at the fallback.
    assert.deepEqual(s.committed(defined)['color'], PROCESSED_LINK);
  });

  it('is inherited by the text under the element that reads it, as the colour itself', () => {
    const s = app(`:root { --accent: ${LINK}; } .a { color: var(--accent); }`);
    const a = s.element('a');
    const label = s.element('', 'text', a);
    s.engine.commit();
    assert.deepEqual(s.committed(a)['color'], PROCESSED_LINK);
    assert.deepEqual(s.committed(label)['color'], PROCESSED_LINK);
  });

  it('may be a system colour, as the same colour written out is', () => {
    const s = app(
      ':root { --link: LinkText; } .direct { color: LinkText; } .token { color: var(--link); }',
    );
    const direct = s.element('direct');
    const token = s.element('token');
    s.engine.commit();
    assert.ok(s.committed(direct)['color'] !== undefined);
    assert.deepEqual(s.committed(token)['color'], s.committed(direct)['color']);
  });

  it('is the shape Android reads on Android', async () => {
    const { registerPlatformComponents } = await import('@ng-native/fabric');
    registerPlatformComponents('android');
    try {
      const s = app(`:root { --accent: ${LINK}; } .a { background-color: var(--accent); }`);
      const a = s.element('a');
      s.engine.commit();
      assert.deepEqual(s.committed(a)['backgroundColor'], {
        processed: { resource_paths: ['link', '?attr/colorAccent'] },
      });
    } finally {
      registerPlatformComponents('ios');
    }
  });
});

describe('the sheets a token holding platform-color() can be in', () => {
  it("is a component's own", () => {
    const s = app('');
    const c = s.component('own', `.inner { --accent: ${LINK}; color: var(--accent); }`);
    s.engine.commit();
    assert.deepEqual(s.committed(c.inner)['color'], PROCESSED_LINK);
  });

  it("is a component's :host, which the views inside it read", () => {
    const s = app('');
    const c = s.component(
      'hosted',
      `:host { --accent: ${LINK}; } .inner { color: var(--accent); }`,
    );
    s.engine.commit();
    assert.deepEqual(s.committed(c.inner)['color'], PROCESSED_LINK);
  });

  it("is a ViewEncapsulation.None component's, which is a global sheet", () => {
    const s = app('');
    const c = s.component('none', `.inner { --accent: ${LINK}; color: var(--accent); }`, NONE);
    s.engine.commit();
    assert.deepEqual(s.committed(c.inner)['color'], PROCESSED_LINK);
  });

  it("is the global sheet, read in a component's", () => {
    const s = app(`:root { --accent: ${LINK}; }`);
    const c = s.component('reads', '.inner { background-color: var(--accent); }');
    s.engine.commit();
    assert.deepEqual(s.committed(c.inner)['backgroundColor'], PROCESSED_LINK);
  });
});

describe('a token holding platform-color() in one colour scheme', () => {
  it('is the platform colour in the dark, and the plain colour in the light, as the scheme changes', () => {
    const s = app(
      ':root { --accent: rgb(1, 2, 3); }' +
        ` @media (prefers-color-scheme: dark) { :root { --accent: ${LINK}; } }` +
        ' .a { color: var(--accent); }',
    );
    const a = s.element('a');
    s.engine.commit();
    assert.deepEqual(s.committed(a)['color'], { processed: 'rgb(1, 2, 3)' });
    s.engine.updateConditions({ width: 400, height: 800, colorScheme: 'dark' });
    s.engine.commit();
    assert.deepEqual(s.committed(a)['color'], PROCESSED_LINK);
    s.engine.updateConditions({ width: 400, height: 800, colorScheme: 'light' });
    s.engine.commit();
    assert.deepEqual(s.committed(a)['color'], { processed: 'rgb(1, 2, 3)' });
  });

  it('is the plain colour in the dark where the light one is the platform colour', () => {
    const s = app(
      `:root { --accent: ${LINK}; }` +
        ' @media (prefers-color-scheme: dark) { :root { --accent: rgb(1, 2, 3); } }' +
        ' .a { background-color: var(--accent); }',
    );
    const a = s.element('a');
    s.engine.commit();
    assert.deepEqual(s.committed(a)['backgroundColor'], PROCESSED_LINK);
    s.engine.updateConditions({ width: 400, height: 800, colorScheme: 'dark' });
    s.engine.commit();
    assert.deepEqual(s.committed(a)['backgroundColor'], { processed: 'rgb(1, 2, 3)' });
  });
});

describe('a bound custom property holding platform-color()', () => {
  it('is read as the sheet reads one, follows a change, and is gone when unbound', () => {
    const s = app('.a { color: var(--accent); }');
    const a = s.element('a');
    s.engine.setCustomProperty(a, '--accent', LINK);
    s.engine.commit();
    assert.deepEqual(s.committed(a)['color'], PROCESSED_LINK);

    s.engine.setCustomProperty(a, '--accent', 'rgb(1, 2, 3)');
    s.engine.commit();
    assert.deepEqual(s.committed(a)['color'], { processed: 'rgb(1, 2, 3)' });

    s.engine.setCustomProperty(a, '--accent', 'platform-color(label)');
    s.engine.commit();
    assert.deepEqual(s.committed(a)['color'], { processed: { semantic: ['label'] } });

    s.engine.setCustomProperty(a, '--accent', null);
    s.engine.commit();
    assert.equal(s.committed(a)['color'], null, 'removed from native, not left as it was');
  });

  it('is read by a bound declaration, whole, and dropped from a bound mix', () => {
    const s = app(`:root { --accent: ${LINK}; }`);
    const a = s.element('');
    s.engine.setBoundStyle(a, 'color', 'var(--accent)');
    s.engine.setBoundStyle(a, 'backgroundColor', 'color-mix(in srgb, var(--accent) 50%, white)');
    s.engine.commit();
    assert.deepEqual(s.committed(a)['color'], PROCESSED_LINK);
    assert.equal(s.committed(a)['backgroundColor'], undefined);
    const said = warnings.filter((line) => line.includes('platform'));
    assert.equal(said.length, 1, warnings.join('\n'));
    assert.match(said[0]!, /backgroundColor, bound on <view>,.*var\(--accent\)/);
  });

  it('drops a bound mix whose fallback is a platform colour, which has no channels either', () => {
    const s = app('');
    const a = s.element('');
    s.engine.setBoundStyle(
      a,
      'color',
      'color-mix(in srgb, var(--unset, platform-color(link)) 50%, white)',
    );
    s.engine.commit();
    assert.equal(s.committed(a)['color'], undefined);
  });

  it('is a word, read as no colour, when it names nothing', () => {
    const s = app('.a { color: var(--accent, rgb(1, 2, 3)); }');
    const a = s.element('a');
    s.engine.setCustomProperty(a, '--accent', 'platform-color()');
    s.engine.commit();
    assert.equal(s.committed(a)['color'], undefined);
  });
});

describe('a token holding platform-color() across a hot swap', () => {
  it("follows a component's sheet from a plain colour to the platform's and back, and away", () => {
    const s = app('');
    const c = s.component('swapped', '.inner { --accent: rgb(1, 2, 3); color: var(--accent); }');
    s.engine.commit();
    assert.deepEqual(s.committed(c.inner)['color'], { processed: 'rgb(1, 2, 3)' });

    c.swap(`.inner { --accent: ${LINK}; color: var(--accent); }`);
    assert.deepEqual(s.committed(c.inner)['color'], PROCESSED_LINK);

    c.swap('.inner { --accent: rgb(4, 5, 6); color: var(--accent); }');
    assert.deepEqual(s.committed(c.inner)['color'], { processed: 'rgb(4, 5, 6)' });

    c.swap(`.inner { --accent: ${LINK}; color: var(--accent); }`);
    c.swap('.inner { color: var(--accent); }');
    assert.equal(s.committed(c.inner)['color'], undefined, 'no token, no colour');
  });

  it('follows a global sheet replaced by one that defines it otherwise', () => {
    const s = app('.a { color: var(--accent); }');
    const a = s.element('a');
    const first = compileCss(':root { --accent: rgb(1, 2, 3); }', 'theme.css') as StyleSheet;
    s.engine.addGlobalSheet(first);
    s.engine.commit();
    assert.deepEqual(s.committed(a)['color'], { processed: 'rgb(1, 2, 3)' });

    const second = compileCss(`:root { --accent: ${LINK}; }`, 'theme.css') as StyleSheet;
    s.engine.addGlobalSheet(second, first);
    s.engine.commit();
    assert.deepEqual(s.committed(a)['color'], PROCESSED_LINK);

    const third = compileCss(':root { --accent: rgb(4, 5, 6); }', 'theme.css') as StyleSheet;
    s.engine.addGlobalSheet(third, second);
    s.engine.commit();
    assert.deepEqual(s.committed(a)['color'], { processed: 'rgb(4, 5, 6)' });
  });
});

describe('a token holding platform-color() where a colour has to be worked out', () => {
  /** Each place a colour's channels are needed, with the prop it would land in. */
  const UNRESOLVABLE: [string, string, string][] = [
    ['a color-mix()', 'color: color-mix(in srgb, var(--accent) 50%, white)', 'color'],
    [
      "a color-mix() with transparent, Tailwind's opacity modifier",
      'background-color: color-mix(in oklab, var(--accent) 50%, transparent)',
      'backgroundColor',
    ],
    ['a relative colour', 'color: rgb(from var(--accent) r g b / 0.5)', 'color'],
    [
      'a gradient',
      'background-image: linear-gradient(var(--accent), red)',
      'experimental_backgroundImage',
    ],
    ['a box-shadow', 'box-shadow: 0 1px 2px var(--accent)', 'boxShadow'],
    ['a shadow token', 'box-shadow: var(--glow)', 'boxShadow'],
    ['a token mixed from it', 'color: var(--mixed)', 'color'],
    [
      "a border shorthand's mixed colour",
      'border: 1px solid color-mix(in srgb, var(--accent) 50%, white)',
      'borderTopColor',
    ],
  ];
  const TOKENS =
    `:root { --accent: ${LINK}; --glow: 0 1px 2px var(--accent);` +
    ' --mixed: color-mix(in srgb, var(--accent) 50%, white); }';

  for (const [label, declaration, prop] of UNRESOLVABLE) {
    it(`drops ${label}, and says so in development, once`, () => {
      const s = app(`${TOKENS} .a { ${declaration}; }`);
      const a = s.element('a');
      // Another in a scope of its own, dropped again, but said once.
      const scope = s.element('');
      s.engine.setCustomProperty(scope, '--elsewhere', '1px');
      s.element('a', 'view', scope);
      s.engine.commit();
      assert.equal(s.committed(a)[prop], undefined);
      const said = warnings.filter((line) => line.includes('platform'));
      assert.equal(said.length, 1, warnings.join('\n'));
      assert.match(said[0]!, /works a colour out of var\(--accent\)/);
      assert.ok(said[0]!.includes(prop), said[0]);
    });

    it(`works out ${label} from a plain colour in the same token`, () => {
      const s = app(`${TOKENS.replace(LINK, 'rgb(0, 0, 255)')} .a { ${declaration}; }`);
      const a = s.element('a');
      s.engine.commit();
      assert.notEqual(s.committed(a)[prop], undefined);
      assert.deepEqual(
        warnings.filter((line) => line.includes('platform')),
        [],
      );
    });
  }

  it('says nothing of it where it is read as no colour at all', () => {
    // A width of a colour token is unset, as any token of the wrong kind leaves it.
    const s = app(`${TOKENS} .a { width: var(--accent); }`);
    const a = s.element('a');
    s.engine.commit();
    assert.equal(s.committed(a)['width'], undefined);
    assert.deepEqual(warnings, []);
  });

  it("keeps a text shadow's colour, which is a colour prop of its own", () => {
    // `textShadowColor` goes through processColor as `color` does; a box shadow's colour is
    // part of a value native parses itself.
    const s = app(`${TOKENS} .a { text-shadow: 0 1px 2px var(--accent); }`);
    const a = s.element('a', 'text');
    s.engine.commit();
    assert.deepEqual(s.committed(a)['textShadowColor'], PROCESSED_LINK);
    assert.deepEqual(warnings, []);
  });

  it('drops a mix with currentColor where the colour in scope is a platform one', () => {
    const s = app(
      `:root { --accent: ${LINK}; --ink: currentColor; } .a { color: var(--accent);` +
        ' border-top-color: color-mix(in srgb, var(--ink) 50%, white); }',
    );
    const a = s.element('a');
    s.engine.commit();
    assert.deepEqual(s.committed(a)['color'], PROCESSED_LINK);
    assert.equal(s.committed(a)['borderTopColor'], undefined);
  });

  /** What the build says of a sheet with `css` after a token holding a platform colour. */
  const buildSays = (css: string): string[] => {
    const dropped: string[] = [];
    compileCss(`:root { --accent: ${LINK}; --alias: var(--accent); }\n${css}`, 'app.css', {
      onUnsupported: (message) => dropped.push(message),
    });
    return dropped;
  };

  for (const [label, declaration] of [
    ['a color-mix()', 'color: color-mix(in srgb, var(--accent) 50%, white)'],
    [
      "Tailwind's opacity modifier",
      'background-color: color-mix(in oklab, var(--accent) 50%, transparent)',
    ],
    ['a relative colour', 'color: rgb(from var(--accent) r g b / 0.5)'],
    ['a gradient', 'background-image: linear-gradient(var(--accent), red)'],
    ['a box-shadow', 'box-shadow: 0 1px 2px var(--accent)'],
    ['a token that is another name for it', 'color: color-mix(in srgb, var(--alias) 50%, white)'],
    [
      'a fallback that names it',
      'color: color-mix(in srgb, var(--unset, var(--accent)) 50%, white)',
    ],
    [
      "a border shorthand's colour",
      'border: 1px solid color-mix(in srgb, var(--accent) 50%, white)',
    ],
  ] as const) {
    it(`says so at build time of ${label}, in the sheet that defines the token`, () => {
      const property = declaration.slice(0, declaration.indexOf(':'));
      const said = buildSays(`.a { ${declaration}; }`);
      assert.equal(said.length, 1, said.join('\n'));
      assert.match(said[0]!, new RegExp(`^app\\.css:2: '${property}' is dropped on device`));
      assert.match(said[0]!, /var\(--(accent|alias)\), which holds a platform colour/);
    });
  }

  it('says so at build time of a token defined to work a colour out of it', () => {
    const said = buildSays(
      ':root { --glow: 0 1px 2px var(--accent); --mixed: color-mix(in srgb, var(--accent) 50%, white); }',
    );
    assert.equal(said.length, 2, said.join('\n'));
    assert.match(said[0]!, /'--glow' is dropped on device: .*var\(--accent\)/);
    assert.match(said[1]!, /'--mixed' is dropped on device: .*var\(--accent\)/);
  });

  it('says nothing at build time where the token is only read as a colour', () => {
    assert.deepEqual(
      buildSays(
        '.a { color: var(--alias); border: 1px solid var(--accent);' +
          ' background-color: light-dark(var(--accent), red); text-shadow: 0 1px 2px var(--accent);' +
          ' --plain: var(--accent); }',
      ),
      [],
    );
  });
});

describe('a token holding platform-color() in a transition', () => {
  it('changes to and from it at once, as there is nothing to blend', () => {
    const s = app(
      `:root { --accent: ${LINK}; } .a { transition: color 200ms linear; color: rgb(0, 0, 0); }` +
        ' .a.on { color: var(--accent); }',
    );
    const a = s.element('a');
    s.engine.commit();
    s.engine.setClasses(a, 'a on');
    s.engine.commit();
    s.tick(100);
    assert.deepEqual(s.committed(a)['color'], PROCESSED_LINK);
    s.engine.setClasses(a, 'a');
    s.engine.commit();
    s.tick(250);
    assert.deepEqual(s.committed(a)['color'], { processed: 'rgb(0, 0, 0)' });
  });
});
