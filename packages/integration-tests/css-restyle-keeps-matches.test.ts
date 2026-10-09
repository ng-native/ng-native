/**
 * An element styled again because something above it changed keeps the rules it matched, where
 * the change cannot have altered them: a custom property set on a box, or a class that rules name
 * only for the element that has it or for particular elements beneath. Finding the rules is most
 * of what styling an element costs, and a theme's token or a `dark` class on the root otherwise
 * finds them again for every element on the screen.
 *
 * Two halves. The first counts the rules tried, which is what the change is for. The second is
 * what it must not cost: a tree changed at random, one change at a time, commits what an engine
 * built afresh in the same state commits.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import { resetStyleStats, styleStats } from '../fabric/src/css.ts';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');
const sheet = (css: string): StyleSheet => {
  const refused: string[] = [];
  const compiled = compileCss(css, 'app.css', {
    onUnsupported: (message: string) => refused.push(message),
  }) as StyleSheet;
  assert.deepEqual(refused, [], 'every rule of the sheet compiles');
  return compiled;
};

const find = (nodes: readonly FakeFabricNode[], id: string): FakeFabricNode | undefined => {
  for (const each of nodes) {
    const found = each.props['nativeID'] === id ? each : find(each.children, id);
    if (found) return found;
  }
  return undefined;
};

/** A panel of twenty rows, each a title, a detail and a badge. */
function scene(css: string) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet(css) });
  const add = (classes: string, id: string, parent: EngineNode): EngineNode => {
    const node = engine.createElement('view');
    engine.setClasses(node, classes);
    engine.setProp(node, 'nativeID', id);
    engine.appendChild(parent, node);
    return node;
  };
  const app = add('app', 'app', engine.root);
  const panel = add('panel', 'panel', app);
  const rows: EngineNode[] = [];
  for (let i = 0; i < 20; i++) {
    const row = add('row', `row${i}`, panel);
    rows.push(row);
    add('title', `title${i}`, row);
    add('detail', `detail${i}`, row);
    add('badge', `badge${i}`, row);
  }
  engine.commit();
  /** The rules tried against elements while a change is committed. */
  const tried = (change: () => void): number => {
    resetStyleStats();
    change();
    engine.commit();
    return styleStats.ruleTests;
  };
  const props = (id: string) => find(fabric.committed, id)!.props;
  return { engine, app, panel, rows, tried, props };
}

const THEME =
  '.app { --tint: rgb(1, 1, 1); --gap: 4px; color: rgb(10, 10, 10) } ' +
  '.row { row-gap: var(--gap) } .title { color: var(--tint) } .detail { opacity: 0.5 } ' +
  '.badge { background-color: var(--tint) } ' +
  '.title:where(.dark, .dark *) { color: rgb(200, 200, 200) } ' +
  '.panel:where(.dark, .dark *) { background-color: rgb(20, 20, 20) } ' +
  '[data-any] .none { opacity: 1 }';

describe('a custom property set on a box', () => {
  it('reaches every element under it that reads it', () => {
    const s = scene(THEME);
    s.engine.setCustomProperty(s.app, '--tint', 'rgb(9, 9, 9)');
    s.engine.setCustomProperty(s.app, '--gap', '12px');
    s.engine.commit();
    assert.equal(s.props('title7')['color'], 'rgb(9, 9, 9)');
    assert.equal(s.props('badge7')['backgroundColor'], 'rgb(9, 9, 9)');
    assert.equal(s.props('row7')['rowGap'], 12);
    s.engine.setCustomProperty(s.app, '--tint', null);
    s.engine.commit();
    assert.equal(s.props('title7')['color'], 'rgb(1, 1, 1)');
  });

  it('finds the rules of the box again and of nothing under it', () => {
    const s = scene(THEME);
    const first = s.tried(() => s.engine.setCustomProperty(s.app, '--tint', 'rgb(9, 9, 9)'));
    assert.ok(first > 0, 'the box itself is matched');
    assert.ok(first < 12, `${first} rules tried for one box of 82 elements`);
  });

  it('is in scope for a rule of the box it is set on', () => {
    const s = scene('.app { --gap: 4px } .panel { row-gap: var(--gap) }');
    s.engine.setCustomProperty(s.panel, '--gap', '20px');
    s.engine.commit();
    assert.equal(s.props('panel')['rowGap'], 20);
  });
});

describe('a class rules name for its own element and for elements under it', () => {
  it('restyles the element and those the rules are for, coming and going', () => {
    const s = scene(THEME);
    s.engine.addClass(s.app, 'dark');
    s.engine.commit();
    assert.equal(s.props('title3')['color'], 'rgb(200, 200, 200)');
    assert.equal(s.props('panel')['backgroundColor'], 'rgb(20, 20, 20)');
    assert.equal(s.props('detail3')['opacity'], 0.5);
    s.engine.removeClass(s.app, 'dark');
    s.engine.commit();
    assert.equal(s.props('title3')['color'], 'rgb(1, 1, 1)');
    assert.equal(s.props('panel')['backgroundColor'] ?? null, null);
  });

  it('finds the rules again only of the element and of those the rules are for', () => {
    const s = scene(THEME);
    const all = s.tried(() => s.engine.setProp(s.app, 'data-any', true));
    const dark = s.tried(() => s.engine.addClass(s.app, 'dark'));
    // The app, the panel and twenty titles are matched again. The sixty rows, details and
    // badges, each of which one rule could be for, are not.
    assert.ok(dark > 0 && dark <= all - 60, `${dark} rules tried, of ${all} for every element`);
  });

  it('restyles one of those elements that is under another of them', () => {
    const s = scene('.box:where(.dark, .dark *) { opacity: 0.5 } .row { opacity: 1 }');
    const outer = s.engine.createElement('view');
    s.engine.setClasses(outer, 'box');
    s.engine.setProp(outer, 'nativeID', 'outer');
    const inner = s.engine.createElement('view');
    s.engine.setClasses(inner, 'box');
    s.engine.setProp(inner, 'nativeID', 'inner');
    s.engine.appendChild(outer, inner);
    s.engine.appendChild(s.rows[0]!, outer);
    s.engine.commit();
    s.engine.addClass(s.app, 'dark');
    s.engine.commit();
    assert.equal(s.props('outer')['opacity'], 0.5);
    assert.equal(s.props('inner')['opacity'], 0.5);
    s.engine.removeClass(s.app, 'dark');
    s.engine.commit();
    assert.equal(s.props('inner')['opacity'] ?? 1, 1);
  });
});

describe('a change that can alter what any element beneath matches', () => {
  const cases: Record<string, { css: string; change: (s: ReturnType<typeof scene>) => void }> = {
    'a prop a selector reads': {
      css: '.detail { opacity: 0.5 } [data-open] .detail { opacity: 0.25 }',
      change: (s) => s.engine.setProp(s.app, 'data-open', true),
    },
    'a class inside :not() of what an element is under': {
      css: '.detail { opacity: 0.25 } .app:not(.off) .detail { opacity: 0.5 }',
      change: (s) => s.engine.removeClass(s.app, 'off'),
    },
    'a class beside the box an element is under': {
      css: '.detail { opacity: 0.5 } .on + .panel .detail { opacity: 0.25 }',
      change: (s) => {
        const before = s.engine.createElement('view');
        s.engine.insertBefore(s.app, before, s.panel);
        s.engine.commit();
        s.engine.addClass(before, 'on');
      },
    },
    'a global sheet added': {
      css: '.detail { opacity: 0.5 }',
      change: (s) => s.engine.addGlobalSheet(sheet('.app .detail { opacity: 0.25 }')),
    },
    'the box moved under another': {
      css: '.detail { opacity: 0.5 } .other .detail { opacity: 0.25 }',
      change: (s) => {
        const other = s.engine.createElement('view');
        s.engine.setClasses(other, 'other');
        s.engine.appendChild(s.app, other);
        s.engine.commit();
        s.engine.removeChild(s.app, s.panel);
        s.engine.appendChild(other, s.panel);
      },
    },
  };
  for (const [name, { css, change }] of Object.entries(cases)) {
    it(`still matches them again: ${name}`, () => {
      const s = scene(css);
      // `.off` is there from the start for the case that takes it away.
      if (css.includes('.off')) {
        s.engine.addClass(s.app, 'off');
        s.engine.commit();
        assert.equal(s.props('detail4')['opacity'], 0.25);
        change(s);
        s.engine.commit();
        assert.equal(s.props('detail4')['opacity'], 0.5);
        return;
      }
      assert.equal(s.props('detail4')['opacity'], 0.5);
      change(s);
      s.engine.commit();
      assert.equal(s.props('detail4')['opacity'], 0.25);
    });
  }

  it('matches them again where a token and a class above change in one commit', () => {
    const s = scene(
      '.app { --gap: 4px } .detail { opacity: 0.5; row-gap: var(--gap) } ' +
        '[data-open] .detail { opacity: 0.25 }',
    );
    s.engine.setCustomProperty(s.app, '--gap', '9px');
    s.engine.setProp(s.app, 'data-open', true);
    s.engine.commit();
    assert.equal(s.props('detail4')['opacity'], 0.25);
    assert.equal(s.props('detail4')['rowGap'], 9);
  });
});

describe('a class changed on an element while it is out of the tree', () => {
  it('styles it by the class when it is put back where it was', () => {
    const s = scene(
      '.detail { opacity: 0.5 } .faint { opacity: 0.25 } .faint .mark { opacity: 0 }',
    );
    const row = s.rows[4]!;
    const detail = row.children[1] as EngineNode;
    const mark = s.engine.createElement('view');
    s.engine.setClasses(mark, 'mark');
    s.engine.setProp(mark, 'nativeID', 'mark');
    s.engine.appendChild(detail, mark);
    s.engine.commit();
    assert.equal(s.props('detail4')['opacity'], 0.5);

    // Styled before, so not an element still being built: its classes are asked about.
    s.engine.removeChild(row, detail);
    s.engine.addClass(detail, 'faint');
    s.engine.insertBefore(row, detail, row.children[1] ?? null);
    s.engine.commit();
    assert.equal(s.props('detail4')['opacity'], 0.25);
    assert.equal(s.props('mark')['opacity'], 0);
  });
});

describe('a box moved between two that share the one cache of boxes with nothing to style', () => {
  it('has what is under it matched again, though a token set on it is all that marked it', () => {
    const component = sheet('.dark .inner { opacity: 0.25 } .inner { opacity: 0.5 }');
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, {});
    const box = (classes: string): EngineNode => {
      const node = engine.createElement('view');
      if (classes) engine.setClasses(node, classes);
      engine.appendChild(engine.root, node);
      return node;
    };
    const dark = box('dark');
    const plain = box('');
    const moved = engine.createElement('view', component);
    const inner = engine.createElement('view', component);
    engine.setClasses(inner, 'inner');
    engine.setProp(inner, 'nativeID', 'inner');
    engine.appendChild(moved, inner);
    engine.appendChild(dark, moved);
    engine.commit();
    // Every cache is made again, and the two boxes at the top come to share one.
    engine.updateConditions({ width: 500, height: 800, colorScheme: 'light' });
    assert.equal(dark.styleCache, plain.styleCache, 'the two share a cache');
    assert.equal(find(fabric.committed, 'inner')!.props['opacity'], 0.25);

    engine.removeChild(dark, moved);
    engine.appendChild(plain, moved);
    engine.setCustomProperty(moved, '--gap', '4px');
    engine.commit();
    assert.equal(find(fabric.committed, 'inner')!.props['opacity'], 0.5);
  });
});

// --- a tree changed at random, against one built afresh ---------------------------------------

const RANDOM_CSS = `
  .a { opacity: 0.9 } .b { margin-top: 2px } .c { color: rgb(1, 2, 3) } .d { font-size: 20px }
  .f { line-height: 1.5 }
  .dark .a { opacity: 0.5 }
  .b:is(.dark *) { margin-top: 4px }
  .c:where(.dark, .dark *) { color: rgb(9, 9, 9) }
  .dark.a { top: 5px }
  .p > .a { padding-left: 3px }
  .a:not(.b) { padding-right: 5px }
  .a + .b { margin-left: 6px }
  .a ~ .c { margin-right: 7px }
  .e:has(.a) { border-top-width: 2px }
  [data-x] .a { padding-top: 8px }
  .a[data-x] { padding-bottom: 9px }
  .b:first-child { top: 1px } .b:last-child { left: 2px } .c:nth-child(2n) { right: 3px }
  .t { --gap: 4px; --tint: rgb(5, 5, 5) } .u { --gap: 8px }
  .g { row-gap: var(--gap, 1px) } .h { background-color: var(--tint, rgb(7, 7, 7)) }
  .x .y .a { bottom: 4px }
  .x > .y > .b { bottom: 6px }
  [class*="da"] .g { height: 3px }
  .a:empty { min-width: 2px }
  .p:not(.x) > .g { column-gap: 2px }
  .t:not(.u) .y .c { min-height: 3px }
  :is(.x, .late) .h { left: 9px }
  .a ~ .d .f { top: 7px }
  .p > :first-child:not(.x) .c { bottom: 2px }
`;
/** The same with no rule that asks about a sibling, a place, `:has()` or `:empty`. */
const PLAIN_CSS = RANDOM_CSS.split('\n')
  .filter((line) => !/[+~]|:has|child|:empty/.test(line))
  .join('\n');
/** A component's own sheet, for the boxes made with it: the others have no rule of their own. */
const COMPONENT_CSS = `
  .a { opacity: 0.8 } .dark .b { margin-top: 5px } .c:is(.dark *) { color: rgb(8, 8, 8) }
  .x .g { row-gap: var(--gap, 2px) } .p > .h { background-color: var(--tint, rgb(6, 6, 6)) }
  .t { --gap: 6px } [data-x] .a { padding-top: 7px } .d { font-size: 18px }
`;
const LATER_CSS =
  '.late .a { max-width: 30px } .late { min-height: 4px } .u .h { max-height: 9px }';
const CLASSES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'p', 't', 'u', 'x', 'y', 'dark', 'late'];

interface Model {
  readonly id: string;
  classes: string[];
  attribute: boolean;
  /** Made with the component's sheet, where the run has one. */
  scoped: boolean;
  tokens: Record<string, string>;
  children: Model[];
}

/** A small generator with a seed, so a failure names the run that found it. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const below = (n: number): number => Math.floor(next() * n);
  return { below, pick: <T>(of: readonly T[]): T => of[below(of.length)]!, chance: () => next() };
}

const everyModel = (model: Model): Model[] => [model, ...model.children.flatMap(everyModel)];

/** The sheets of a run: the app's, where it has one, those added since, and a component's. */
interface Sheets {
  readonly global: StyleSheet | null;
  readonly added: StyleSheet[];
  readonly component: StyleSheet | null;
}

/** An engine holding the tree a model describes, built in one go and committed. */
function build(model: Model, sheets: Sheets) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, sheets.global ? { globalStyles: sheets.global } : {});
  for (const added of sheets.added) engine.addGlobalSheet(added);
  const nodes = new Map<string, EngineNode>();
  const make = (from: Model, parent: EngineNode): void => {
    const node = engine.createElement('view', from.scoped ? sheets.component : null);
    nodes.set(from.id, node);
    if (from.classes.length) engine.setClasses(node, from.classes.join(' '));
    engine.setProp(node, 'nativeID', from.id);
    if (from.attribute) engine.setProp(node, 'data-x', true);
    for (const [name, value] of Object.entries(from.tokens)) {
      engine.setCustomProperty(node, name, value);
    }
    engine.appendChild(parent, node);
    for (const child of from.children) make(child, node);
  };
  make(model, engine.root);
  engine.commit();
  return { engine, fabric, nodes };
}

/**
 * What was committed, as text: each view's props by name, and its children in order. A prop
 * committed as null is one taken away, which a tree built afresh never had.
 */
function committed(nodes: readonly FakeFabricNode[]): string {
  const one = (node: FakeFabricNode): unknown => ({
    view: node.viewName,
    props: Object.fromEntries(
      Object.entries(node.props)
        .filter(([, value]) => value != null && typeof value !== 'function')
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
    children: node.children.map(one),
  });
  return JSON.stringify(nodes.map(one), null, 1);
}

/** A run of the random half: the tree as a model, the engine living through it, and the dice. */
interface Run {
  readonly r: ReturnType<typeof random>;
  readonly model: Model;
  readonly live: ReturnType<typeof build>;
  readonly sheets: Sheets;
  readonly later: StyleSheet;
  fresh(): Model;
}

/** One change to a box, made to the model and to the living engine: what it was, or nothing. */
type Change = (run: Run, target: Model, node: EngineNode) => string | null;

const toggleClass: Change = ({ r, live }, target, node) => {
  const name = r.pick(CLASSES);
  if (target.classes.includes(name)) {
    target.classes = target.classes.filter((each) => each !== name);
    live.engine.removeClass(node, name);
    return `${target.id} -.${name}`;
  }
  target.classes.push(name);
  live.engine.addClass(node, name);
  return `${target.id} +.${name}`;
};

const setClasses: Change = ({ r, live }, target, node) => {
  target.classes = CLASSES.filter(() => r.chance() < 0.25);
  live.engine.setClasses(node, target.classes.join(' '));
  return `${target.id} class="${target.classes.join(' ')}"`;
};

const setToken: Change = ({ r, live }, target, node) => {
  const name = r.pick(['--gap', '--tint']);
  if (name in target.tokens && r.chance() < 0.5) {
    delete target.tokens[name];
    live.engine.setCustomProperty(node, name, null);
    return `${target.id} -${name}`;
  }
  const value = name === '--gap' ? `${1 + r.below(30)}px` : `rgb(${r.below(255)}, 0, 0)`;
  target.tokens[name] = value;
  live.engine.setCustomProperty(node, name, value);
  return `${target.id} ${name}: ${value}`;
};

const toggleAttribute: Change = ({ live }, target, node) => {
  target.attribute = !target.attribute;
  live.engine.setProp(node, 'data-x', target.attribute ? true : undefined);
  return `${target.id} data-x=${target.attribute}`;
};

const addChild: Change = ({ live, sheets, fresh }, target, node) => {
  const child = fresh();
  target.children.push(child);
  const built = live.engine.createElement('view', child.scoped ? sheets.component : null);
  live.nodes.set(child.id, built);
  if (child.classes.length) live.engine.setClasses(built, child.classes.join(' '));
  live.engine.setProp(built, 'nativeID', child.id);
  if (child.attribute) live.engine.setProp(built, 'data-x', true);
  live.engine.appendChild(node, built);
  return `${target.id} gains ${child.id} .${child.classes.join('.')}`;
};

/** Moved to the end of another box that is not under it, or taken out. */
const moveOrRemove: Change = ({ r, model, live }, target, node) => {
  if (target === model) return null;
  const all = everyModel(model);
  const parent = all.find((each) => each.children.includes(target))!;
  const under = new Set(everyModel(target));
  parent.children = parent.children.filter((each) => each !== target);
  live.engine.removeChild(live.nodes.get(parent.id)!, node);
  if (r.chance() >= 0.7) return `${target.id} goes`;
  const home = r.pick(all.filter((each) => !under.has(each)));
  home.children.push(target);
  live.engine.appendChild(live.nodes.get(home.id)!, node);
  return `${target.id} moves under ${home.id}`;
};

const addSheet: Change = ({ r, live, sheets, later }) => {
  if (sheets.added.length || r.chance() >= 0.3) return null;
  sheets.added.push(later);
  live.engine.addGlobalSheet(later);
  return 'a sheet is added';
};

/** Ten to draw from: classes most often, as an app changes them most. */
const CHANGES: readonly Change[] = [
  toggleClass,
  toggleClass,
  toggleClass,
  setClasses,
  setToken,
  setToken,
  toggleAttribute,
  addChild,
  moveOrRemove,
  addSheet,
];

describe('a tree changed at random, a few changes a commit', () => {
  const SEEDS = Number(process.env['RESTYLE_SEEDS'] ?? 40);
  const COMMITS = 40;

  /** Each asks different things of the engine: what it marks hangs on what the sheets ask. */
  const kinds: Record<string, () => Omit<Sheets, 'added'>> = {
    'a sheet that asks about siblings, places and :has()': () => ({
      global: sheet(RANDOM_CSS),
      component: null,
    }),
    'a sheet that asks about none of them': () => ({ global: sheet(PLAIN_CSS), component: null }),
    'a component sheet on some boxes and no other': () => ({
      global: null,
      component: sheet(COMPONENT_CSS),
    }),
    'an app sheet and a component sheet': () => ({
      global: sheet(PLAIN_CSS),
      component: sheet(COMPONENT_CSS),
    }),
  };

  for (const [name, makeSheets] of Object.entries(kinds)) {
    it(`commits what an engine built afresh in the same state commits: ${name}`, () => {
      const later = sheet(LATER_CSS);
      let changes = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = random(seed);
        const sheets: Sheets = { ...makeSheets(), added: [] };
        let made = 0;
        const fresh = (): Model => ({
          id: `n${made++}`,
          classes: CLASSES.filter(() => r.chance() < 0.2),
          attribute: r.chance() < 0.1,
          scoped: sheets.component !== null && r.chance() < 0.6,
          tokens: {},
          children: [],
        });
        const model = fresh();
        for (let i = 0; i < 24; i++) r.pick(everyModel(model)).children.push(fresh());

        const run: Run = { r, model, live: build(model, sheets), sheets, later, fresh };
        const log: string[] = [];

        for (let commit = 0; commit < COMMITS; commit++) {
          // One change, or two or three in one commit, where the marks of one meet another's.
          for (let left = 1 + r.below(3); left > 0; left--) {
            // Of what is in the tree now: an earlier change of this commit may have taken one out.
            const target = r.pick(everyModel(model));
            const did = r.pick(CHANGES)(run, target, run.live.nodes.get(target.id)!);
            if (did !== null) log.push(did);
          }
          run.live.engine.commit();
          const expected = committed(build(model, sheets).fabric.committed);
          const actual = committed(run.live.fabric.committed);
          // Compared before asserting: the message is built only for a run that failed.
          if (actual !== expected) {
            const last = log.slice(-8).join('; ');
            assert.equal(actual, expected, `seed ${seed}, after ${log.length} changes: ${last}`);
          }
        }
        changes += log.length;
      }
      assert.ok(changes > SEEDS * COMMITS, `${changes} changes were made and compared`);
    });
  }
});

describe('the elements after one that changed', () => {
  // A rule can read an element from one after it, `.row[aria-busy] ~ .note`, so those after are
  // matched again. Where they match what they did, what is under them is left: only a rule that
  // goes on under, and names them, reads that far.
  const AFTER =
    '.row { row-gap: 2px } .title { color: rgb(1, 1, 1) } .detail { opacity: 0.5 } ' +
    '.badge { opacity: 0.25 } .row[aria-busy] ~ .note { opacity: 0.5 }';

  it('are matched again themselves, and not what is under them', () => {
    const s = scene(AFTER);
    const last = s.tried(() => s.engine.setProp(s.rows[19]!, 'aria-busy', 'true'));
    const first = s.tried(() => s.engine.setProp(s.rows[0]!, 'aria-busy', 'true'));
    // Nineteen rows after the first, each tried against the one rule a row can match.
    assert.equal(first, last + 19);
  });

  it('keep what is under them where a rule reads a place from under an element they are not in', () => {
    // A library's rule for the first thing in its own list, whatever that is, names no class
    // an element could be told from: it is told from the list it would have to be in.
    const s = scene(`${AFTER} .list > :first-child:not(.x) .title { color: rgb(9, 9, 9) }`);
    const last = s.tried(() => s.engine.setProp(s.rows[19]!, 'aria-busy', 'true'));
    const first = s.tried(() => s.engine.setProp(s.rows[0]!, 'aria-busy', 'true'));
    assert.equal(first, last + 19);
  });

  it('are styled again with what is under them in the list such a rule is for', () => {
    const s = scene(
      `${AFTER} .panel > :not(.x):first-child .title { color: rgb(9, 9, 9) } ` +
        '.panel > [aria-busy] ~ :not(.x) .detail { opacity: 0.75 }',
    );
    s.engine.setProp(s.rows[0]!, 'aria-busy', 'true');
    s.engine.commit();
    assert.equal(s.props('detail7')['opacity'], 0.75);
    s.engine.setProp(s.rows[0]!, 'aria-busy', undefined);
    s.engine.commit();
    assert.equal(s.props('detail7')['opacity'], 0.5);
  });

  it('are styled again where they match another rule, and again where they no longer do', () => {
    const s = scene(`${AFTER} .row[aria-busy] ~ .row { opacity: 0.75 }`);
    s.engine.setProp(s.rows[0]!, 'aria-busy', 'true');
    s.engine.commit();
    assert.equal(s.props('row7')['opacity'], 0.75);
    s.engine.setProp(s.rows[0]!, 'aria-busy', undefined);
    s.engine.commit();
    assert.ok(s.props('row7')['opacity'] == null);
  });

  it('are styled again with what is under them where a rule goes on under them', () => {
    const s = scene(`${AFTER} .row[aria-busy] ~ .row .title { color: rgb(9, 9, 9) }`);
    const colour = () => s.props('title7')['color'];
    const before = colour();
    s.engine.setProp(s.rows[0]!, 'aria-busy', 'true');
    s.engine.commit();
    assert.notDeepEqual(colour(), before);
    s.engine.setProp(s.rows[0]!, 'aria-busy', undefined);
    s.engine.commit();
    assert.deepEqual(colour(), before);
  });
});

describe('a default style given to an element that is styled already', () => {
  // What a package gives an element as a browser's own default: a table's cell its share of the
  // row, each time the table is measured. No selector reads it, and nothing inherits it.
  it('is committed with no rule tried, for it or for what is under it', () => {
    const s = scene('.row { row-gap: 2px } .title { color: rgb(1, 1, 1) }');
    const tried = s.tried(() => s.engine.setDefaultStyle(s.rows[0]!, { height: 30, rowGap: 9 }));
    assert.equal(tried, 0);
    assert.equal(s.props('row0')['height'], 30);
    // A rule's declaration still stands over it.
    assert.equal(s.props('row0')['rowGap'], 2);
    s.engine.setDefaultStyle(s.rows[0]!, undefined);
    s.engine.commit();
    assert.ok(s.props('row0')['height'] == null);
  });
});

describe('a class a rule asks a box not to have', () => {
  // `.field:not(.disabled) .label`: a library writes its states this way, and the class comes
  // and goes on a box with a screen of other things under it.
  const NOT =
    '.panel { row-gap: 1px } .row { row-gap: 2px } .title { color: rgb(1, 1, 1) } ' +
    '.detail { opacity: 0.5 } .badge { opacity: 0.25 } ' +
    '.panel:not(.busy) .title { color: rgb(9, 9, 9) }';

  it('has the elements the rule is for matched again, and no other under the box', () => {
    const s = scene(NOT);
    const before = s.props('title7')['color'];
    const tried = s.tried(() => s.engine.addClass(s.panel, 'busy'));
    // Each of twenty titles, against the two rules for a title.
    assert.equal(tried, 20 * 2);
    assert.notDeepEqual(s.props('title7')['color'], before);
    s.engine.removeClass(s.panel, 'busy');
    s.engine.commit();
    assert.deepEqual(s.props('title7')['color'], before);
  });
});
