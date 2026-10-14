/**
 * `<search-field>`: the platform's own search field anywhere, not only in a navigation bar. It is
 * `@ng-native/expo`'s own native view, `UISearchBar` on iOS and `SearchView` on Android.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
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
