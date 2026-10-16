/**
 * `<search-field>`: the platform's own search field anywhere, not only in a navigation bar. It is
 * `@ng-native/expo`'s own native view, `UISearchBar` on iOS and `SearchView` on Android.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import {
  inject,
  provideEnvironmentInitializer,
  type Type,
  type WritableSignal,
} from '@angular/core';
import {
  Engine,
  fontsLoading,
  fontsSettled,
  registerPlatformComponents,
  type StyleSheet,
} from '@ng-native/fabric';
import { cleanup, fireEvent, render, screen, settle } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/search-field.ts');
});

afterEach(() => {
  cleanup();
  registerPlatformComponents('ios');
});

interface Host {
  readonly field: () => { focus(): Promise<void>; blur(): Promise<void>; clear(): void };
  readonly query: WritableSignal<string>;
  readonly searched: () => string | null;
  readonly cancelled: () => number;
  readonly focused: () => boolean;
}

async function idle(): Promise<void> {
  for (let turn = 0; turn < 3; turn++) await settle();
}

async function start(functions: object | null = {}) {
  const Field = mod['SearchField'] as { SOURCE: unknown };
  const app = await render(mod['SearchFieldHost'] as Type<unknown>, {
    providers: [{ provide: Field.SOURCE, useValue: functions }],
  });
  await idle();
  return { ...app, host: app.instance as Host, field: () => screen.getByTestId('field') };
}

describe('a search field', () => {
  it('is the native view, with its placeholder and the query as its text', async () => {
    const { field } = await start();
    assert.match(field().viewName, /^ViewManagerAdapter_NgNativeSearchField/);
    assert.equal(field().props['placeholder'], 'Search colours');
    assert.equal(field().props['text'], '');
  });

  it('writes what the user types into the query', async () => {
    const { field, host } = await start();
    await fireEvent(field(), 'topChangeText', { text: 'ind' });
    assert.equal(host.query(), 'ind');
  });

  it('says which keystroke its text answers, so native keeps keystrokes typed since', async () => {
    // Typing "abc" fast: the query for "ab" can come back after "c" was typed.
    const { field } = await start();
    await fireEvent(field(), 'topChangeText', { text: 'ab', eventCount: 2 });
    assert.equal(field().props['text'], 'ab');
    assert.equal(field().props['mostRecentEventCount'], 2);
  });

  it('puts a query set from code in the field', async () => {
    const { field, host } = await start();
    host.query.set('teal');
    await idle();
    assert.equal(field().props['text'], 'teal');
  });

  it('reports the search key with the text, and the cancel button', async () => {
    const { field, host } = await start();
    await fireEvent(field(), 'topSubmitSearch', { text: 'indigo' });
    assert.equal(host.searched(), 'indigo');
    await fireEvent(field(), 'topPressCancel', {});
    assert.equal(host.cancelled(), 1);
  });

  it('reports the keyboard coming and going', async () => {
    const { field, host } = await start();
    await fireEvent(field(), 'topBeginEditing', {});
    assert.equal(host.focused(), true);
    await fireEvent(field(), 'topEndEditing', {});
    assert.equal(host.focused(), false);
  });

  it('focuses and blurs from code, through the functions native defines on the view', async () => {
    const calls: [string, number][] = [];
    const { host, field } = await start({
      focus(this: { nativeTag: number }) {
        calls.push(['focus', this.nativeTag]);
        return Promise.resolve();
      },
      blur(this: { nativeTag: number }) {
        calls.push(['blur', this.nativeTag]);
        return Promise.resolve();
      },
    });
    await host.field().focus();
    await host.field().blur();
    assert.deepEqual(calls, [
      ['focus', field().reactTag],
      ['blur', field().reactTag],
    ]);
  });

  it('empties the field and the query on clear', async () => {
    const { field, host } = await start();
    await fireEvent(field(), 'topChangeText', { text: 'ind' });
    host.field().clear();
    await idle();
    assert.equal(host.query(), '');
    assert.equal(field().props['text'], '');
  });

  it('says what to do in a build without it, such as Expo Go, and draws nothing', async () => {
    const warned: unknown[] = [];
    const warn = console.warn;
    console.warn = (message: unknown) => warned.push(message);
    try {
      const { host, fabric } = await start(null);
      assert.match(String(warned[0]), /search-field.*development build/);
      // Fabric draws a view it does not know as a placeholder box naming it.
      const all = (nodes: typeof fabric.committed): typeof fabric.committed =>
        nodes.flatMap((node) => [node, ...all(node.children)]);
      const field = all(fabric.committed).find((node) => node.props['nativeID'] === 'field');
      assert.equal(field, undefined, 'not committed, so native has nothing to draw');
      await host.field().focus();
    } finally {
      console.warn = warn;
    }
  });
});

describe('a search field in a Signal Forms form', () => {
  interface FormHost {
    readonly locked: WritableSignal<boolean>;
    readonly model: () => { text: string };
    readonly filter: { text: () => { touched(): boolean } };
  }

  async function boot() {
    const app = await render(mod['SearchFieldForm'] as Type<unknown>, {
      providers: [{ provide: (mod['SearchField'] as { SOURCE: unknown }).SOURCE, useValue: {} }],
    });
    await idle();
    return { host: app.instance as FormHost, field: () => screen.getByTestId('filter') };
  }

  it('shows the field and writes typing into it', async () => {
    const { host, field } = await boot();
    assert.equal(field().props['text'], 'teal');
    await fireEvent(field(), 'topChangeText', { text: 'coral', eventCount: 1 });
    assert.equal(host.model().text, 'coral');
  });

  it('marks the field touched when it gives up the keyboard', async () => {
    const { host, field } = await boot();
    assert.equal(host.filter.text().touched(), false);
    await fireEvent(field(), 'topEndEditing', {});
    assert.equal(host.filter.text().touched(), true);
  });

  it('is disabled while the form says so, and enabled again after', async () => {
    const { host, field } = await boot();
    assert.equal(field().props['enabled'], true);
    host.locked.set(true);
    await idle();
    assert.equal(field().props['enabled'], false);
    host.locked.set(false);
    await idle();
    assert.equal(field().props['enabled'], true);
  });
});

/** The faces a stylesheet declared for Brand, each with the PostScript name its file says. */
const BRAND: StyleSheet = {
  rules: [],
  fonts: [
    { family: 'Brand', source: 1, postScriptName: 'Brand-Regular' },
    { family: 'Brand', source: 2, weight: 700, postScriptName: 'Brand-Bold' },
  ],
};

describe("a search field's type", () => {
  /** The field on a page set in Brand, beside the app's sheet that declares its faces. */
  async function inBrand(platform: 'ios' | 'android') {
    registerPlatformComponents(platform);
    const Field = mod['SearchField'] as { SOURCE: unknown };
    await render(mod['SearchFieldInBrand'] as Type<unknown>, {
      providers: [
        { provide: Field.SOURCE, useValue: {} },
        provideEnvironmentInitializer(() => inject(Engine).addGlobalSheet(BRAND)),
      ],
    });
    await idle();
    return (id = 'field') => screen.getByTestId(id).props;
  }

  it("is the page's face on iOS, by the PostScript name UIKit finds it by", async () => {
    const props = await inBrand('ios');
    assert.equal(props()['fontFamily'], 'Brand-Bold');
    assert.equal(props()['fontSize'], 20);
  });

  it("is the page's face on Android, by the name expo-font registers it under", async () => {
    const props = await inBrand('android');
    assert.equal(props()['fontFamily'], 'Brand-700');
    assert.equal(props()['fontSize'], 20);
  });

  it('is a face set on the field itself, by the same name', async () => {
    assert.equal((await inBrand('ios'))('inline')['fontFamily'], 'Brand-Bold');
  });

  it('is held back while its face loads, and named once it has', async () => {
    // The family a load asks for is the face matched, and native finds no face before it registers.
    fontsLoading(['Brand-700']);
    let settled = false;
    try {
      const props = await inBrand('ios');
      assert.equal(props()['fontFamily'], undefined, 'the system font while loading');
      fontsSettled(['Brand-700']);
      settled = true;
      await idle();
      assert.equal(props()['fontFamily'], 'Brand-Bold');
    } finally {
      if (!settled) fontsSettled(['Brand-700']);
    }
  });

  it('leaves a family no @font-face declares as written, for the system to find', async () => {
    assert.equal((await inBrand('ios'))('system')['fontFamily'], 'Georgia');
  });

  it('keeps a weight and a style no face was matched for, for the system font to draw', async () => {
    for (const platform of ['ios', 'android'] as const) {
      const props = (await inBrand(platform))('bold-italic');
      assert.equal(props['fontWeight'], 'bold', platform);
      assert.equal(props['fontStyle'], 'italic', platform);
      cleanup();
    }
  });

  it('keeps them beside a family no @font-face declares', async () => {
    const props = (await inBrand('ios'))('system-bold');
    assert.equal(props['fontFamily'], 'Georgia');
    assert.equal(props['fontWeight'], 700);
    assert.equal(props['fontStyle'], 'italic');
  });
});
