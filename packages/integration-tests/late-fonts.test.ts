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
});
