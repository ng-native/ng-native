/**
 * A face that registers after the text naming it was laid out.
 *
 * `loadFonts` is not awaited before `mount` in the splash-screen pattern, so the first commit can
 * lay out text before its face is registered. Native keeps what it built from that: iOS caches
 * the attributed string and its measurement by what the paragraph asks for, and that has not
 * changed, so it stays in the fallback face however long after the font arrives. Committing it
 * again unchanged hits the same cache. It has to ask for something different that looks the
 * same: a text size cap no platform reaches.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import {
  cleanup,
  createFakeFabric,
  render,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { Engine, registerPlatformComponents, registerViewName } from '@ng-native/fabric';
import { FontRegistry, type NativeFonts } from '@ng-native/expo/fonts';
import { compileFixture } from './compile.ts';

/** What `registerPlatformComponents('android')` renames, as iOS names them. */
const IOS_VIEW_NAMES = {
  switch: 'Switch',
  'text-input': 'TextInput',
  'activity-indicator': 'ActivityIndicatorView',
  'refresh-control': 'PullToRefreshView',
  'safe-area-view': 'SafeAreaView',
  'input-accessory-view': 'InputAccessoryView',
};

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

/** A stand-in for `expo-font` that registers what it is given, or fails for the names listed. */
function nativeFonts(failing: readonly string[] = []): NativeFonts {
  const registered = new Set<string>();
  return {
    loadAsync: async (map) => {
      for (const family of Object.keys(map)) {
        if (!failing.includes(family)) registered.add(family);
      }
      if (failing.length) throw new Error(`could not load ${failing.join(', ')}`);
    },
    isLoaded: (family) => registered.has(family),
    getLoadedFonts: () => [...registered],
  };
}

let LateFonts: Type<unknown>;

before(async () => {
  const mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/late-fonts.ts', import.meta.url)),
  );
  LateFonts = mod['LateFonts'] as Type<unknown>;
});

afterEach(cleanup);
after(cleanup);

/** The paragraph a label is in, as it stands in the latest commit. */
function paragraph(fabric: FakeFabric, label: string): FakeFabricNode {
  const found = flatten(fabric.committed).find(
    (node) =>
      node.viewName === 'Paragraph' &&
      flatten(node.children).some((child) => child.props['text'] === label),
  );
  assert.ok(found, `a paragraph containing "${label}"`);
  return found;
}

const LABELS = ['Title', 'code line', 'Plain', 'Some ', 'Inherited'];

/** Each paragraph's tag, and the props native keys its text layout by. */
function snapshot(
  fabric: FakeFabric,
): Record<string, { tag: number; props: FakeFabricNode['props'] }> {
  return Object.fromEntries(
    LABELS.map((label) => {
      const node = paragraph(fabric, label);
      return [label, { tag: node.reactTag, props: { ...node.props } }];
    }),
  );
}

/**
 * Whether native lays a paragraph out again: the same view, asking for something it has not
 * cached, with no cap a real text size reaches.
 */
function laidOutAgain(before: FakeFabricNode['props'], after: FakeFabricNode): boolean {
  const cap = after.props['maxFontSizeMultiplier'];
  return cap !== before['maxFontSizeMultiplier'] && typeof cap === 'number' && cap >= 1000;
}

describe('a face registered after its text was laid out', () => {
  it('lays out again the text naming it, in the same view', async () => {
    const { fabric } = await render(LateFonts);
    const before = snapshot(fabric);

    await new FontRegistry(nativeFonts()).load({ 'Inter-600': 1 });

    const title = paragraph(fabric, 'Title');
    assert.ok(laidOutAgain(before['Title']!.props, title), 'the paragraph naming the face');
    assert.ok(laidOutAgain(before['Some ']!.props, paragraph(fabric, 'Some ')), 'one with a span');
    assert.equal(title.reactTag, before['Title']!.tag, 'the view is kept, not created again');
    assert.deepEqual(
      { ...title.props, maxFontSizeMultiplier: undefined },
      { ...before['Title']!.props, maxFontSizeMultiplier: undefined },
      'and nothing else it asks for moved',
    );
    assert.deepEqual(paragraph(fabric, 'code line').props, before['code line']!.props);
    assert.deepEqual(paragraph(fabric, 'Plain').props, before['Plain']!.props);
  });

  it('reaches text that inherits the family from a view', async () => {
    const { fabric } = await render(LateFonts);
    const before = snapshot(fabric);

    await new FontRegistry(nativeFonts()).load({ 'JetBrains Mono': 1 });

    assert.ok(laidOutAgain(before['code line']!.props, paragraph(fabric, 'code line')));
    assert.ok(laidOutAgain(before['Inherited']!.props, paragraph(fabric, 'Inherited')));
    assert.deepEqual(paragraph(fabric, 'Title').props, before['Title']!.props);
  });

  it('reaches text written straight into a view, which has a paragraph of its own', async () => {
    const { fabric } = await render(LateFonts);
    const bare = { ...paragraph(fabric, 'Bare').props };

    await new FontRegistry(nativeFonts()).load({ 'Inter-600': 1 });

    assert.ok(laidOutAgain(bare, paragraph(fabric, 'Bare')));
  });

  it('asks for something new each time, so a second face is not answered from the cache', async () => {
    const { fabric } = await render(LateFonts);

    await new FontRegistry(nativeFonts()).load({ 'Inter-600': 1 });
    const first = { ...paragraph(fabric, 'Title').props };
    await new FontRegistry(nativeFonts()).load({ 'Inter-600': 1 });

    assert.ok(laidOutAgain(first, paragraph(fabric, 'Title')));
  });

  it('still lays out the text for the faces that did load when another fails', async () => {
    const { fabric } = await render(LateFonts);
    const before = snapshot(fabric);

    await assert.rejects(
      new FontRegistry(nativeFonts(['JetBrains Mono'])).load({
        'Inter-600': 1,
        'JetBrains Mono': 2,
      }),
      /could not load/,
    );

    assert.ok(laidOutAgain(before['Title']!.props, paragraph(fabric, 'Title')));
    assert.deepEqual(
      paragraph(fabric, 'code line').props,
      before['code line']!.props,
      'a face that failed changes nothing',
    );
  });

  it('commits nothing for an app unmounted before the face registered', async () => {
    const { fabric, unmount } = await render(LateFonts);
    unmount();
    const commits = fabric.calls.completeRoot;

    await new FontRegistry(nativeFonts()).load({ 'Inter-600': 1 });

    assert.equal(fabric.calls.completeRoot, commits);
  });
});

/** The text input showing a placeholder, as it stands in the latest commit. */
function field(fabric: FakeFabric, placeholder: string): FakeFabricNode {
  const found = flatten(fabric.committed).find((node) => node.props['placeholder'] === placeholder);
  assert.ok(found, `a text input with placeholder "${placeholder}"`);
  return found;
}

/**
 * Every prop payload the engine clones a view with from here on, by tag. Android applies a text
 * input's props from that payload alone, so a prop left out of it is not applied again.
 */
function payloads(fabric: FakeFabric): Map<number, Record<string, unknown>> {
  const sent = new Map<number, Record<string, unknown>>();
  const record = (node: unknown, props: object) =>
    sent.set((node as FakeFabricNode).reactTag, props as Record<string, unknown>);
  const withProps = fabric.cloneNodeWithNewProps.bind(fabric);
  const withBoth = fabric.cloneNodeWithNewChildrenAndProps.bind(fabric);
  fabric.cloneNodeWithNewProps = (node, props) => {
    record(node, props);
    return withProps(node, props);
  };
  fabric.cloneNodeWithNewChildrenAndProps = (node, props) => {
    record(node, props);
    return withBoth(node, props);
  };
  return sent;
}

describe('a face still loading when its text is first laid out', () => {
  // Native caches a text's measurement by its family name, not by the cap the engine moves, so text
  // measured in the fallback under the face's name kept that size once the face drew (#345).
  it('lays its text out in the fallback, without the name, until the face registers', async () => {
    let finish: () => void = () => {};
    const registered = new Set<string>();
    const native: NativeFonts = {
      loadAsync: (map) =>
        new Promise<void>((resolve) => {
          finish = () => {
            for (const family of Object.keys(map)) registered.add(family);
            resolve();
          };
        }),
      isLoaded: (family) => registered.has(family),
      getLoadedFonts: () => [...registered],
    };
    const loading = new FontRegistry(native).load({ 'Inter-600': 1 });
    const { fabric } = await render(LateFonts);
    assert.equal(paragraph(fabric, 'Title').props['fontFamily'], undefined, 'held while loading');
    assert.equal(paragraph(fabric, 'Bare').props['fontFamily'], undefined, 'bare text too');
    assert.equal(paragraph(fabric, 'code line').props['fontFamily'], 'JetBrains Mono');

    finish();
    await loading;

    assert.equal(paragraph(fabric, 'Title').props['fontFamily'], 'Inter-600');
    const span = flatten(paragraph(fabric, 'Some ').children).find(
      (node) => node.props['fontFamily'] !== undefined,
    );
    assert.equal(span?.props['fontFamily'], 'Inter-600', 'a span inside a paragraph too');
    assert.equal(paragraph(fabric, 'Bare').props['fontFamily'], 'Inter-600', 'and bare text');
  });

  it('gives the text its family back when the face fails to load', async () => {
    // As before the hold: the name is asked for, and native finds whatever it has by it.
    let fail: () => void = () => {};
    const native: NativeFonts = {
      loadAsync: () =>
        new Promise<void>((_, reject) => {
          fail = () => reject(new Error('could not load Inter-600'));
        }),
      isLoaded: () => false,
      getLoadedFonts: () => [],
    };
    const loading = new FontRegistry(native).load({ 'Inter-600': 1 });
    const { fabric } = await render(LateFonts);
    assert.equal(paragraph(fabric, 'Title').props['fontFamily'], undefined, 'held while loading');

    fail();
    await assert.rejects(loading, /could not load/);

    assert.equal(paragraph(fabric, 'Title').props['fontFamily'], 'Inter-600');
  });
});

describe('a face registered after a text input naming it was laid out', () => {
  it('sets the font again on the same view, keeping its focus and typed text', async () => {
    const { fabric } = await render(LateFonts);
    fabric.emit(field(fabric, 'Name'), 'topFocus', {});
    fabric.emit(field(fabric, 'Name'), 'topChange', { text: 'Ada', eventCount: 3 });
    await new Promise((resolve) => setTimeout(resolve));
    const before = field(fabric, 'Name');
    const beforeProps = { ...before.props };
    const commands = fabric.commands.length;
    const sent = payloads(fabric);

    await new FontRegistry(nativeFonts()).load({ 'Inter-600': 1 });

    const after = field(fabric, 'Name');
    assert.ok(
      laidOutAgain(beforeProps, after),
      'iOS rebuilds its font when its text attributes move',
    );
    assert.equal(after.reactTag, before.reactTag, 'the view is kept, not created again');
    assert.deepEqual(
      { ...after.props, maxFontSizeMultiplier: undefined },
      { ...beforeProps, maxFontSizeMultiplier: undefined },
      'and nothing else it asks for moved',
    );
    assert.equal(after.props['text'], 'Ada');
    assert.deepEqual(fabric.commands.slice(commands), [], 'no command moves its focus or its text');
    assert.equal(
      sent.get(after.reactTag)?.['fontFamily'],
      'Inter-600',
      'Android sets a font only when it is sent',
    );
  });

  it('reaches a multiline input and leaves inputs in other families alone', async () => {
    const { fabric } = await render(LateFonts);
    const notes = { ...field(fabric, 'Notes').props };
    const name = { ...field(fabric, 'Name').props };
    const plain = { ...field(fabric, 'Plain field').props };

    await new FontRegistry(nativeFonts()).load({ 'JetBrains Mono': 1 });

    assert.ok(laidOutAgain(notes, field(fabric, 'Notes')));
    assert.deepEqual(field(fabric, 'Name').props, name);
    assert.deepEqual(field(fabric, 'Plain field').props, plain);
  });
});

describe('the engine laying text out again for a face', () => {
  function engineWithText(props: Record<string, unknown>) {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const text = engine.createElement('text');
    for (const [key, value] of Object.entries(props)) engine.setProp(text, key, value);
    engine.appendChild(text, engine.createText('Hello'));
    engine.appendChild(engine.root, text);
    engine.commit();
    const committed = () => flatten(fabric.committed).find((n) => n.viewName === 'Paragraph')!;
    return { engine, text, committed };
  }

  it("keeps the cap through the paragraph's next commit, or native would find the old layout", () => {
    const { engine, text, committed } = engineWithText({ style: { fontFamily: 'Inter' } });
    engine.fontsRegistered(new Set(['Inter']));
    const cap = committed().props['maxFontSizeMultiplier'];

    engine.setProp(text, 'testID', 'greeting');
    engine.commit();

    assert.equal(committed().props['testID'], 'greeting');
    assert.equal(committed().props['maxFontSizeMultiplier'], cap);
  });

  it("moves the app's own cap by a step per face its text names, too little to see", () => {
    const { engine, committed } = engineWithText({
      style: { fontFamily: 'Inter' },
      maxFontSizeMultiplier: 1.5,
    });
    const cap = () => committed().props['maxFontSizeMultiplier'] as number;
    engine.fontsRegistered(new Set(['Inter']));
    const once = cap();
    engine.fontsRegistered(new Set(['Mono']));
    assert.equal(cap(), once, 'a face it does not name moves nothing');
    engine.fontsRegistered(new Set(['Inter']));
    const twice = cap();

    // React Native tells text attributes apart at 0.005, so each step has to clear that.
    assert.ok(once - 1.5 > 0.005 && once - 1.5 < 0.01, `${once} caps where 1.5 did`);
    assert.ok(twice - once > 0.005 && twice - 1.5 < 0.02, `${twice} still caps where 1.5 did`);
  });

  it('does the same on Android, which keys and caps its text the same way', () => {
    registerPlatformComponents('android');
    try {
      const { engine, committed } = engineWithText({ style: { fontFamily: 'Inter' } });
      assert.equal(committed().viewName, 'Paragraph');
      engine.fontsRegistered(new Set(['Inter']));
      assert.ok((committed().props['maxFontSizeMultiplier'] as number) >= 1000);
    } finally {
      registerPlatformComponents('ios');
      for (const [element, viewName] of Object.entries(IOS_VIEW_NAMES)) {
        registerViewName(element, viewName);
      }
    }
  });

  it("sends an Android text input's font once, with its cap, and not on its next commit", () => {
    registerPlatformComponents('android');
    try {
      const fabric = createFakeFabric();
      const engine = new Engine(fabric, 1);
      const input = engine.createElement('text-input');
      engine.setProp(input, 'style', { fontFamily: 'Inter' });
      engine.setProp(input, 'text', 'Ada');
      engine.appendChild(engine.root, input);
      engine.commit();
      const tag = fabric.committed[0]!.reactTag;
      assert.equal(fabric.committed[0]!.viewName, 'AndroidTextInput');
      const sent = payloads(fabric);

      engine.fontsRegistered(new Set(['Inter']));
      const refresh = sent.get(tag);
      engine.setProp(input, 'text', 'Adam');
      engine.commit();

      assert.equal(refresh?.['fontFamily'], 'Inter', 'ReactEditText sets a typeface when sent one');
      assert.ok((refresh?.['maxFontSizeMultiplier'] as number) >= 1000);
      assert.deepEqual(sent.get(tag), { text: 'Adam' }, 'a keystroke later sends only itself');
      assert.equal(fabric.committed[0]!.reactTag, tag);
    } finally {
      registerPlatformComponents('ios');
      for (const [element, viewName] of Object.entries(IOS_VIEW_NAMES)) {
        registerViewName(element, viewName);
      }
    }
  });
});
