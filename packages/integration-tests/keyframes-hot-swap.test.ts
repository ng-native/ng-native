/**
 * `@keyframes` across a hot swap. A browser drops the rules of a stylesheet that is edited or
 * removed, so an animation naming keyframes the edit deleted stops, and one naming keyframes
 * another sheet still defines plays those. The same holds for an emulated component's sheet and
 * a `ViewEncapsulation.None` one, which the platform registers as a global sheet.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { NativeRendererFactory } from '@ng-native/platform';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

const EMULATED = 0;
const NONE = 2;

/**
 * An app whose global sheet gives `.spinner` an animation, with components whose own sheets
 * define the keyframes it names, rendered and hot-swapped the way Angular's HMR does it.
 */
function app(globalCss: string, options: { inScroll?: boolean } = {}) {
  let now = 1000;
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(globalCss) as StyleSheet,
    now: () => now,
  });
  const factory = new NativeRendererFactory(engine);
  const spinner = engine.createElement('view');
  /** Where the spinner sits: in a scroll view, for an animation that scrolling plays. */
  let outer = spinner;
  if (options.inScroll) {
    outer = engine.createElement('scroll-view');
    engine.appendChild(outer, spinner);
  }
  engine.addClass(spinner, 'spinner');
  /** Each component's class, and the view it has in the tree. */
  const components = new Map<string, { type: object; view: EngineNode | null }>();

  function render(id: string, encapsulation: number): void {
    const component = components.get(id)!;
    const renderer = factory.createRenderer(engine.createElement('view'), {
      id,
      encapsulation,
      type: component.type,
    } as never);
    component.view = renderer.createElement('view') as EngineNode;
    engine.appendChild(engine.root, component.view);
  }

  return {
    engine,
    /** First render of each component, by id, with its CSS, in that order. */
    mount(sheets: Record<string, string>, encapsulation = EMULATED): void {
      for (const [id, css] of Object.entries(sheets)) {
        const type = { ɵnativeStyles: compileCss(css, id) as StyleSheet };
        components.set(id, { type, view: null });
        render(id, encapsulation);
      }
      // After the component, so the sheet that defines the keyframes is in by the time it styles.
      engine.appendChild(engine.root, outer);
      engine.commit();
    },
    /**
     * A hot swap to `css`: the sheet on the class changes, and the views are made again. Left
     * out, the class keeps the sheet it has, as after an edit to the encapsulation alone.
     */
    swap(id: string, css: string | null | undefined, encapsulation = EMULATED): void {
      const component = components.get(id)!;
      if (css !== undefined) {
        (component.type as Record<string, unknown>)['ɵnativeStyles'] =
          css === null ? undefined : (compileCss(css, id) as StyleSheet);
      }
      factory.componentReplaced(id);
      engine.removeChild(engine.root, component.view!);
      engine.destroyNode(component.view!);
      render(id, encapsulation);
      engine.commit();
    },
    opacity: () =>
      flatten(fabric.committed).find((node) => node.instanceHandle === spinner)!.props['opacity'],
    tick(ms: number): void {
      now += ms;
      engine.advanceAnimations();
      engine.commit();
    },
  };
}

const GLOBAL = `
  view { opacity: 1 }
  .spinner { animation: pulse 100ms linear infinite }
`;

for (const [label, encapsulation] of [
  ['an emulated', EMULATED],
  ['a ViewEncapsulation.None', NONE],
] as const) {
  describe(`${label} component's @keyframes, hot-swapped`, () => {
    it('stop playing once the edit deletes them', () => {
      const s = app(GLOBAL);
      s.mount(
        { pulser: '@keyframes pulse { from { opacity: 0.25 } to { opacity: 0.75 } }' },
        encapsulation,
      );
      assert.equal(s.opacity(), 0.25, 'the animation plays the first frame');

      s.swap('pulser', 'view { padding: 1px }', encapsulation);
      assert.equal(s.opacity(), 1, 'the resting style, as nothing defines pulse any more');
      s.tick(50);
      assert.equal(s.opacity(), 1);
      assert.equal(s.engine.animating, false, 'and nothing is left ticking');
    });

    it('stop playing once the edit renames them', () => {
      const s = app(GLOBAL);
      s.mount(
        { pulser: '@keyframes pulse { from { opacity: 0.25 } to { opacity: 0.75 } }' },
        encapsulation,
      );
      s.swap(
        'pulser',
        '@keyframes throb { from { opacity: 0.5 } to { opacity: 1 } }',
        encapsulation,
      );
      s.tick(50);
      assert.equal(s.opacity(), 1);
      assert.equal(s.engine.animating, false);
    });

    it('stop playing when the edit leaves the component no CSS at all', () => {
      const s = app(GLOBAL);
      s.mount(
        { pulser: '@keyframes pulse { from { opacity: 0.25 } to { opacity: 0.75 } }' },
        encapsulation,
      );
      s.swap('pulser', null, encapsulation);
      assert.equal(s.opacity(), 1);
    });

    it("hand the name back to the app's own keyframes of that name, mid-animation", () => {
      const s = app(`${GLOBAL} @keyframes pulse { from { opacity: 0.5 } to { opacity: 0.5 } }`);
      s.mount(
        { pulser: '@keyframes pulse { from { opacity: 0.25 } to { opacity: 0.25 } }' },
        encapsulation,
      );
      assert.equal(s.opacity(), 0.25, "the component's, which comes later, wins the tie");

      s.tick(30);
      s.swap('pulser', 'view { padding: 1px }', encapsulation);
      assert.equal(s.opacity(), 0.5, "the app's, still defined, now plays");
      s.tick(30);
      assert.equal(s.opacity(), 0.5);
    });

    it('play the edited frames when the edit keeps the name', () => {
      const s = app(GLOBAL);
      s.mount(
        { pulser: '@keyframes pulse { from { opacity: 0.25 } to { opacity: 0.25 } }' },
        encapsulation,
      );
      s.swap(
        'pulser',
        '@keyframes pulse { from { opacity: 0.75 } to { opacity: 0.75 } }',
        encapsulation,
      );
      assert.equal(s.opacity(), 0.75);
    });
  });
}

describe('two components defining the same @keyframes, one hot-swapped', () => {
  for (const [label, encapsulation] of [
    ['emulated', EMULATED],
    ['ViewEncapsulation.None', NONE],
  ] as const) {
    it(`keeps the other's when the edit deletes them from one (${label})`, () => {
      const s = app(GLOBAL);
      s.mount(
        {
          first: '@keyframes pulse { from { opacity: 0.25 } to { opacity: 0.25 } }',
          second: '@keyframes pulse { from { opacity: 0.5 } to { opacity: 0.5 } }',
        },
        encapsulation,
      );
      assert.equal(s.opacity(), 0.5, 'the later one wins, as the later of two sheets does');

      s.swap('first', 'view { padding: 1px }', encapsulation);
      assert.equal(s.opacity(), 0.5, 'deleting the losing copy changes nothing');
      s.swap('second', 'view { padding: 1px }', encapsulation);
      assert.equal(s.opacity(), 1, 'and deleting the last one stops it');
    });

    it(`keeps a swapped sheet where it was among the others (${label})`, () => {
      const s = app(GLOBAL);
      s.mount(
        {
          first: '@keyframes pulse { from { opacity: 0.25 } to { opacity: 0.25 } }',
          second: '@keyframes pulse { from { opacity: 0.5 } to { opacity: 0.5 } }',
        },
        encapsulation,
      );
      s.swap(
        'first',
        '@keyframes pulse { from { opacity: 0.75 } to { opacity: 0.75 } }',
        encapsulation,
      );
      assert.equal(s.opacity(), 0.5, 'an edit changes a sheet in place rather than moving it last');
    });
  }
});

describe("a hot swap of a component's encapsulation alone, which keeps its sheet", () => {
  for (const [from, to] of [
    [EMULATED, NONE],
    [NONE, EMULATED],
  ] as const) {
    it(`keeps its @keyframes playing (${from === NONE ? 'None to emulated' : 'emulated to None'})`, () => {
      const s = app(GLOBAL);
      s.mount({ pulser: '@keyframes pulse { from { opacity: 0.25 } to { opacity: 0.25 } }' }, from);
      s.swap('pulser', undefined, to);
      assert.equal(s.opacity(), 0.25);
    });
  }
});

describe('a scroll-driven animation, when its @keyframes are hot-swapped', () => {
  const SCROLLED = `
    view { opacity: 1 }
    .spinner { animation: pulse linear; animation-timeline: scroll() }
  `;

  it('stops once the edit deletes them', () => {
    const s = app(SCROLLED, { inScroll: true });
    s.mount({ pulser: '@keyframes pulse { from { opacity: 0.25 } to { opacity: 0.75 } }' });
    assert.equal(s.opacity(), 0.25, 'the frame at the offset the view starts at');

    s.swap('pulser', 'view { padding: 1px }');
    assert.equal(s.opacity(), 1);
  });

  it('lays the edited frames along the offset when the edit keeps the name', () => {
    const s = app(SCROLLED, { inScroll: true });
    s.mount({ pulser: '@keyframes pulse { from { opacity: 0.25 } to { opacity: 0.75 } }' });
    s.swap('pulser', '@keyframes pulse { from { opacity: 0.5 } to { opacity: 0.75 } }');
    assert.equal(s.opacity(), 0.5);
  });
});

describe('a finished animation holding its last frame, when its @keyframes are deleted', () => {
  it('lets go of the frame, as the animation is gone', () => {
    const s = app(`
      view { opacity: 1 }
      .spinner { animation: pulse 100ms linear forwards }
    `);
    s.mount({ pulser: '@keyframes pulse { from { opacity: 0.25 } to { opacity: 0.75 } }' });
    s.tick(150);
    assert.equal(s.opacity(), 0.75, 'held by forwards');

    s.swap('pulser', 'view { padding: 1px }');
    assert.equal(s.opacity(), 1);
  });
});
