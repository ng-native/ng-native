/**
 * `::before` and `::after`, for a library's stylesheet the build is told was written for a
 * browser. A browser draws a box of its own for each inside the element, first and last, wherever
 * a rule gives it a `content`. No template declares one, so the engine keeps a view there itself,
 * styled by the rules written for it.
 *
 * An app's own stylesheet is refused them as it always was: the compiler takes them only when
 * it is asked to.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { createLaidOutFabric } from './laid-out-fabric.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss(
    css: string,
    context: string,
    options?: { generated?: boolean; onUnsupported?: (message: string) => void },
  ): { rules: Record<string, unknown>[] };
};

const generated = (css: string) => compileCss(css, 'library.css', { generated: true });

describe('a ::before or ::after rule, compiled', () => {
  it('is refused in a sheet that was not asked for generated boxes', () => {
    assert.throws(
      () => compileCss('.a::before { content: "" }', 'app.css'),
      /pseudo-elements like ::before are never supported/,
    );
  });

  it('is a rule for the box as a child of the element, with its content', () => {
    const { rules } = generated(
      '.a > .b::before { content: ""; width: 4px } .c::after { content: none }',
    );
    const [before, after] = rules.sort((a, b) => Number(a['order']) - Number(b['order']));
    assert.deepEqual(before!['compounds'], [
      { classes: ['a'] },
      { classes: ['b'] },
      { classes: [], type: '::before' },
    ]);
    assert.deepEqual(before!['combinators'], ['child', 'child']);
    assert.deepEqual(before!['declarations'], { content: '', width: 4 });
    assert.deepEqual(after!['compounds'], [{ classes: ['c'] }, { classes: [], type: '::after' }]);
    assert.deepEqual(after!['declarations'], { content: 'none' });
  });

  it('weighs what the selector weighs in a browser: the element, and one more type', () => {
    const { rules } = generated('.a b { width: 1px } .a::before { content: "" }');
    const [plain, box] = rules.sort((a, b) => Number(a['order']) - Number(b['order']));
    assert.equal(box!['specificity'], plain!['specificity']);
  });

  it('says on the sheet whether it has a rule for a box, for the engine to look only there', () => {
    assert.equal((generated('.a::before { content: "" }') as { generated?: true }).generated, true);
    assert.equal('generated' in generated('.a { width: 1px }'), false);
  });

  it('still refuses any other pseudo-element, and says so', () => {
    const dropped: string[] = [];
    compileCss('.a::selection { color: red }', 'library.css', {
      generated: true,
      onUnsupported: (message) => dropped.push(message),
    });
    assert.equal(dropped.length, 1);
  });
});

function scene(css: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: generated(css) as never });
  const element = (classes: string, parent: EngineNode = engine.root): EngineNode => {
    const node = engine.createElement('view');
    engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', classes);
    engine.appendChild(parent, node);
    return node;
  };
  const find = (id: string, all: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
    for (const each of all) {
      const found = each.props['nativeID'] === id ? each : find(id, each.children);
      if (found) return found;
    }
    return undefined;
  };
  /** What a box is committed holding: each child's id, or the width that tells a generated box. */
  const held = (id: string): unknown[] => {
    engine.commit();
    return find(id, fabric.committed)!
      .children.filter((child) => child.props['display'] !== 'none')
      .map((child) => child.props['nativeID'] ?? child.props['width']);
  };
  return { engine, fabric, element, held };
}

const BOXES =
  '.a::before { content: ""; width: 1px } .a::after { content: ""; width: 2px } .x { height: 5px }';

describe('a generated box', () => {
  it('is drawn first for ::before and last for ::after, around what the element holds', () => {
    const s = scene(BOXES);
    const a = s.element('a');
    s.element('x', a);
    assert.deepEqual(s.held('a'), [1, 'x', 2]);
  });

  it('stays first and last as children come and go', () => {
    const s = scene(BOXES);
    const a = s.element('a');
    const x = s.element('x', a);
    const y = s.engine.createElement('view');
    s.engine.setProp(y, 'nativeID', 'y');
    s.engine.insertBefore(a, y, x);
    s.element('z', a);
    const w = s.engine.createElement('view');
    s.engine.setProp(w, 'nativeID', 'w');
    s.engine.insertBefore(a, w, null);
    assert.deepEqual(s.held('a'), [1, 'y', 'x', 'z', 'w', 2]);
    s.engine.removeChild(a, y);
    assert.deepEqual(s.held('a'), [1, 'x', 'z', 'w', 2]);
  });

  it('is not drawn where no rule gives it a content, or the rule that wins gives none', () => {
    const s = scene(
      '.a::before { width: 1px } .b::before { content: ""; width: 3px } ' +
        '.b.off::before { content: none }',
    );
    s.element('a');
    s.element('b');
    s.element('b off');
    assert.deepEqual(s.held('a'), []);
    assert.deepEqual(s.held('b'), [3]);
    assert.deepEqual(s.held('b off'), []);
  });

  it('has no view where no rule draws it, and one again once a rule does', () => {
    // A view that is not displayed is still a view: Yoga marks one as laid out each time it
    // measures what holds it, and a debug build of React Native stops at one left marked.
    const s = scene('.b::before { content: ""; width: 3px } .b.off::before { content: none }');
    const b = s.element('b off');
    const views = () => {
      s.engine.commit();
      const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
        nodes.flatMap((node) => [node, ...all(node.children)]);
      return all(s.fabric.committed).find((node) => node.props['nativeID'] === 'b off')!.children;
    };
    assert.equal(views().length, 0);
    s.engine.removeClass(b, 'off');
    assert.deepEqual(
      views().map((view) => view.props['width']),
      [3],
    );
    s.engine.addClass(b, 'off');
    assert.equal(views().length, 0);
  });

  it('comes with the class that a rule gives one to, and goes with it', () => {
    const s = scene(BOXES);
    const plain = s.element('plain');
    assert.deepEqual(s.held('plain'), []);
    s.engine.addClass(plain, 'a');
    assert.deepEqual(s.held('plain'), [1, 2]);
    s.engine.removeClass(plain, 'a');
    assert.deepEqual(s.held('plain'), []);
    s.engine.setClasses(plain, 'plain a');
    assert.deepEqual(s.held('plain'), [1, 2]);
    s.engine.setClasses(plain, 'plain');
    assert.deepEqual(s.held('plain'), []);
  });

  it('comes to the elements a rule names by their name', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {
      globalStyles: generated('x-chip::after { content: "" }') as never,
    });
    const chip = engine.createElement('x-chip');
    const plain = engine.createElement('view');
    assert.deepEqual(
      chip.childList.map((child) => child.tag),
      ['::after'],
    );
    assert.deepEqual(plain.childList, []);
  });

  it('comes only to the elements a rule names inside :is(), and to no other', () => {
    // How Tailwind writes a state: `:is(.trigger:focus, .trigger[data-focus])::after`. The
    // compound has no class of its own, which is not the same as being any element.
    const s = scene(':is(.a:focus, .b[data-on])::after { content: ""; width: 2px }');
    const plain = s.element('plain');
    const a = s.element('a');
    s.engine.commit();
    assert.equal(plain.childList.length, 0);
    assert.equal(a.childList.length, 1);
    s.engine.addClass(plain, 'b');
    s.engine.commit();
    assert.equal(plain.childList.length, 1);
  });

  it('comes to every element for a rule that names none', () => {
    const s = scene('::before { content: ""; width: 1px }');
    const a = s.element('a');
    assert.deepEqual(
      a.childList.map((child) => child.tag),
      ['::before'],
    );
  });

  it('comes to an element that is there already when a sheet with a rule for it is added', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {});
    const a = engine.createElement('view');
    engine.setClasses(a, 'a');
    engine.appendChild(engine.root, a);
    engine.commit();
    engine.addGlobalSheet(generated(BOXES) as never);
    engine.commit();
    assert.deepEqual(
      fabric.committed[0]!.children.map((child) => child.props['width']),
      [1, 2],
    );
  });

  it('is restyled with what its element matches', () => {
    const s = scene('.a::before { content: ""; width: 1px } .on > .a::before { width: 9px }');
    const outer = s.element('outer');
    s.element('a', outer);
    assert.deepEqual(s.held('a'), [1]);
    s.engine.addClass(outer, 'on');
    assert.deepEqual(s.held('a'), [9]);
  });

  it('is no child to a selector that counts children', () => {
    const s = scene(`${BOXES} .x:first-child { width: 7px } .x:last-child { height: 8px }`);
    const a = s.element('a');
    s.element('x', a);
    s.held('a');
    const x = s.fabric.committed[0]!.children[1]!;
    assert.equal(x.props['width'], 7);
    assert.equal(x.props['height'], 8);
  });

  it('is nothing :empty sees', () => {
    const s = scene(`${BOXES} .a:empty { height: 4px }`);
    const a = s.element('a');
    s.engine.commit();
    assert.equal(s.fabric.committed[0]!.props['height'], 4);
    s.element('x', a);
    s.engine.commit();
    assert.equal(s.fabric.committed[0]!.props['height'] ?? null, null);
  });

  it('is not reported as an element nobody declared', () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...message: unknown[]) => void errors.push(message);
    try {
      const fabric = createFakeFabric();
      const engine = new Engine(fabric, 1, { globalStyles: generated(BOXES) as never, dev: true });
      const a = engine.createElement('view');
      engine.setClasses(a, 'a');
      engine.appendChild(engine.root, a);
      engine.commit();
    } finally {
      console.error = original;
    }
    assert.deepEqual(
      errors.filter((message) => String(message).includes('::')),
      [],
    );
  });

  it('takes no content prop to the view', () => {
    const s = scene(BOXES);
    s.element('a');
    s.held('a');
    assert.equal('content' in s.fabric.committed[0]!.children[0]!.props, false);
  });
});

describe('a generated box whose rule goes', () => {
  it('goes from an element when the sheet with its rule is taken away', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {});
    const sheet = generated(BOXES);
    engine.addGlobalSheet(sheet as never);
    const a = engine.createElement('view');
    engine.setClasses(a, 'a');
    engine.appendChild(engine.root, a);
    engine.appendChild(a, engine.createElement('view'));
    assert.equal(a.childList.length, 3);
    engine.removeGlobalSheet(sheet as never);
    assert.equal(a.childList.length, 1);
    engine.commit();
    assert.equal(fabric.committed[0]!.children.length, 1);
  });

  it('goes when a hot swap edits the rule away, and stays where another sheet still gives it', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {});
    const edited = generated('.a::before { content: ""; width: 1px }');
    const kept = generated('.b::after { content: ""; width: 2px }');
    engine.addGlobalSheet(edited as never);
    engine.addGlobalSheet(kept as never);
    const make = (classes: string): EngineNode => {
      const node = engine.createElement('view');
      engine.setClasses(node, classes);
      engine.appendChild(engine.root, node);
      return node;
    };
    const names = (node: EngineNode) => node.childList.map((child) => child.tag);
    const a = make('a');
    const b = make('b');
    assert.deepEqual(names(a), ['::before']);
    assert.deepEqual(names(b), ['::after']);
    engine.addGlobalSheet(generated('.a { width: 1px }') as never, edited as never);
    assert.deepEqual(names(a), []);
    assert.deepEqual(names(b), ['::after']);
  });
});

describe('the words a generated box is given as its content', () => {
  // A library labels a box by its `::before`: "Focus Trap Disabled" over a region, a required
  // field's asterisk. The words are text in the box, drawn as any text in a view is.
  const CSS =
    '.a::before { content: "Off"; color: rgb(1, 2, 3) } .a.on::before { content: "On" } ' +
    '.a.bare::before { content: "" } .a.gone::before { content: none }';

  const scene = () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: generated(CSS) as never });
    const a = engine.createElement('view');
    engine.setClasses(a, 'a');
    engine.appendChild(engine.root, a);
    const words = (node: FakeFabricNode): string =>
      String(node.props['text'] ?? '') + node.children.map(words).join('');
    const drawn = () => {
      engine.commit();
      const [host] = fabric.committed;
      return host!.children.map((child) => `${child.viewName}:${words(child)}`);
    };
    return { engine, a, drawn };
  };

  it('are drawn in it, in a paragraph of its own', () => {
    const s = scene();
    assert.deepEqual(s.drawn(), ['View:Off']);
  });

  it('follow the content changing, to other words, to none, and to no box', () => {
    const s = scene();
    s.drawn();
    s.engine.setClasses(s.a, 'a on');
    assert.deepEqual(s.drawn(), ['View:On']);
    s.engine.setClasses(s.a, 'a bare');
    assert.deepEqual(s.drawn(), ['View:']);
    s.engine.setClasses(s.a, 'a on');
    assert.deepEqual(s.drawn(), ['View:On']);
    s.engine.setClasses(s.a, 'a gone');
    assert.deepEqual(s.drawn(), []);
    s.engine.setClasses(s.a, 'a');
    assert.deepEqual(s.drawn(), ['View:Off']);
  });
});

describe('the words beside a generated box in a line', () => {
  // A library's strut: an empty inline-block `::before` that gives a hint's line its height.
  // Nothing follows it but the words, which are one paragraph still: only a box an element is
  // has words to be placed after, each on the line.
  const CSS =
    '.h { display: block } .h::before { content: ""; display: inline-block; height: 16px } ' +
    '.i { display: inline-block; width: 6px; height: 6px }';

  it('are one paragraph, until an element is on the line with them', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: generated(CSS) as never });
    const h = engine.createElement('view');
    engine.setClasses(h, 'h');
    engine.appendChild(engine.root, h);
    engine.appendChild(h, engine.createText('Whole pounds'));
    const drawn = () => {
      engine.commit();
      return fabric.committed[0]!.children.map((child) => child.viewName);
    };
    assert.deepEqual(drawn(), ['View', 'Paragraph']);
    const i = engine.createElement('view');
    engine.setClasses(i, 'i');
    engine.appendChild(h, i);
    assert.deepEqual(drawn(), ['View', 'Paragraph', 'Paragraph', 'View']);
    engine.removeChild(h, i);
    assert.deepEqual(drawn(), ['View', 'Paragraph']);
  });
});

describe('a box on a line whose generated box writes a space', () => {
  // `content: " "`: nothing is seen of a space, but a browser lays the box out as one with text
  // in it, whose baseline is its text's: the room of its font under it hangs below the line's.
  const CSS =
    '.h { display: block; width: 200px; font-size: 12px; line-height: 16px } ' +
    '.c { display: inline-flex; width: 10px } .i { display: inline-block; width: 4px; height: 30px } ' +
    '.c.spaced::before { content: " " } .c.bare::before { content: "" }';

  const bottom = (classes: string) => {
    const fabric = createLaidOutFabric('classic');
    const engine = new Engine(fabric, 1, { globalStyles: generated(CSS) as never });
    const make = (name: string, parent: EngineNode) => {
      const node = engine.createElement('view');
      engine.setClasses(node, name);
      engine.setProp(node, 'nativeID', name.split(' ')[0]!);
      engine.appendChild(parent, node);
      return node;
    };
    const h = make('h', engine.root);
    make(classes, h);
    make('i', h);
    engine.commit();
    const { top, height } = fabric.box('c');
    return { box: top + height, line: fabric.box('i').top + fabric.box('i').height };
  };

  it('hangs under the baseline, where one with an empty content sits on it', () => {
    const spaced = bottom('c spaced');
    assert.ok(spaced.box - spaced.line > 3, `${spaced.box} under a line at ${spaced.line}`);
    const bare = bottom('c bare');
    assert.equal(bare.box, bare.line);
  });
});

describe('a rule for a generated box that gives it no content', () => {
  // A reset: `*, ::before, ::after { box-sizing: border-box }`. No box is drawn for it, on any
  // element, and none is kept: two boxes for every element of a screen, each matched against
  // every rule there is, were two thirds of what a page of a library's components was made of.
  const CSS =
    '*, ::before, ::after { box-sizing: border-box } .a::before { content: "" } ' +
    '.c::after { content: none; width: 2px }';

  it('keeps a box in no element but the ones a rule gives content', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: generated(CSS) as never });
    const make = (classes: string): EngineNode => {
      const node = engine.createElement('view');
      engine.setClasses(node, classes);
      engine.appendChild(engine.root, node);
      return node;
    };
    const names = (node: EngineNode) => node.childList.map((child) => child.tag);
    assert.deepEqual(names(make('a')), ['::before']);
    assert.deepEqual(names(make('b')), []);
    assert.deepEqual(names(make('c')), []);
    engine.commit();
    assert.equal(fabric.committed[0]!.children.length, 1, 'and the one with content is drawn');
    assert.equal(fabric.committed[0]!.children[0]!.props['boxSizing'], 'border-box');
  });
});

describe('a generated box a rule gives to the element with an attribute', () => {
  // `[ngpFocusTrap]::before { content: '...' }`: a headless library names its elements by
  // attribute, never by class. The box is kept in the elements that have the attribute, and
  // not in every element there is for want of a class to know them by.
  const CSS = '[data-trap]::before { content: "x" } [data-open="yes"]::after { content: "" }';

  it('is kept in an element while it has the attribute, and in no other', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: generated(CSS) as never });
    const make = (): EngineNode => {
      const node = engine.createElement('view');
      engine.appendChild(engine.root, node);
      return node;
    };
    const names = (node: EngineNode) => node.childList.map((child) => child.tag);
    const plain = make();
    const trap = make();
    assert.deepEqual(names(plain), []);
    engine.setProp(trap, 'data-trap', '');
    assert.deepEqual(names(trap), ['::before']);
    assert.deepEqual(names(plain), []);
    engine.setProp(trap, 'data-open', 'yes');
    assert.deepEqual(names(trap), ['::before', '::after']);
    engine.setProp(trap, 'data-trap', null);
    assert.deepEqual(names(trap), ['::after']);
    engine.commit();
    assert.equal(fabric.committed[1]!.children.length, 1);
  });
});

describe('a generated box a rule gives to the element with an id', () => {
  // `#card::before { content: "" }`: a page names one element by its id, and the box is kept
  // in that element, not in every element there is for want of a class to know it by.
  const CSS = '#card::before { content: "" }';

  it('is kept in the element while it has the id, and in no other', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: generated(CSS) as never });
    const make = (): EngineNode => {
      const node = engine.createElement('view');
      engine.appendChild(engine.root, node);
      return node;
    };
    const names = (node: EngineNode) => node.childList.map((child) => child.tag);
    const plain = make();
    const card = make();
    engine.setProp(card, 'nativeID', 'card');
    assert.deepEqual(names(card), ['::before']);
    assert.deepEqual(names(plain), []);
    engine.setProp(card, 'nativeID', 'other');
    assert.deepEqual(names(card), []);
  });
});

describe('a generated box, to a selector that names no element', () => {
  it('is no element to *, and no child to :has()', () => {
    const s = scene(
      '.row > * { width: 9px } .row::before { content: ""; height: 3px }' +
        ' .a:has(> *) { height: 7px } .a::before { content: "" }',
    );
    const row = s.element('row');
    s.element('x', row);
    const a = s.element('a');
    s.engine.commit();
    const committed = (node: EngineNode) => node.committed?.props ?? {};
    const box = row.childList[0]!;
    assert.equal(box.tag, '::before');
    assert.equal(committed(box)['width'], undefined, 'a browser never matches * against it');
    assert.equal(committed(row.childList[1]!)['width'], 9, 'the element beside it still is one');
    assert.equal(committed(a)['height'], undefined, 'a box alone is not something :has(> *) finds');
  });
});

describe("a component's :host::before", () => {
  it('is drawn in each host of the component, styled by the rule, and in no other element', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const sheet = generated(':host::before { content: ""; width: 3px }') as never;
    const host = (id: string) => {
      const node = engine.createElement('view');
      engine.setProp(node, 'nativeID', id);
      engine.appendChild(engine.root, node);
      engine.setHostSheet(node, sheet);
      return node;
    };
    const first = host('first');
    const other = engine.createElement('view');
    engine.appendChild(engine.root, other);
    const second = host('second');
    engine.commit();
    for (const node of [first, second]) {
      assert.deepEqual(
        node.childList.map((child) => child.tag),
        ['::before'],
      );
      assert.equal(node.childList[0]!.committed?.props['width'], 3, 'styled by the host rule');
    }
    assert.deepEqual(other.childList, [], 'an element that is no host has no box');
  });
});

describe('a generated box, in a node that adopts another scope', () => {
  it("is drawn from the adopted sheet's rules, and its box follows the sheet", () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const own = generated('.c { height: 4px }') as never;
    const adopted = generated('.c::before { content: ""; width: 3px }') as never;
    const host = engine.createElement('view', adopted);
    const node = engine.createElement('view', own);
    engine.setClasses(node, 'c');
    engine.appendChild(engine.root, host);
    engine.appendChild(engine.root, node);
    engine.commit();
    // Kept for the rule another sheet has for its class, but drawn by none of its own sheet's.
    assert.ok(!node.childList[0]?.committed, 'its own sheet draws no box');
    engine.adoptScope(node, host);
    engine.commit();
    const box = node.childList[0];
    assert.equal(box?.tag, '::before');
    assert.equal(box?.templateSheet, adopted, 'the box is matched against the adopted sheet');
    assert.equal(box?.committed?.props['width'], 3);
  });
});

describe('a generated box whose content is declared twice', () => {
  it('takes the !important content, as the cascade does', () => {
    const s = scene('.a::before { content: none; content: "x" !important; width: 1px }');
    s.element('a');
    assert.deepEqual(s.held('a'), [1]);
  });
});
