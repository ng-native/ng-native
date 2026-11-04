/**
 * The navigation bar's own search field: react-native-screens' RNSSearchBar, placed in a
 * `<native-header-item type="searchBar">`. Its text is a two-way `query`, as a list filter wants.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { cleanup, fireEvent, render, screen, userEvent } from '@ng-native/testing';
import { registerScreenComponents } from '../router/src/screens.ts';
import { compileFixture } from './compile.ts';

describe('native search bar', () => {
  let Host: Type<unknown>;

  before(async () => {
    registerScreenComponents();
    const mod = await compileFixture('fixtures/search-bar.ts');
    Host = mod['SearchHost'] as Type<unknown>;
  });

  afterEach(() => cleanup());

  // No query covers a lookup by `viewName` alone - `RNSSearchBar` is not a role, testID or text,
  // so the fake Fabric's own `find()` stays for this one, structural, find.
  it('commits the search bar with its placeholder, and follows what is typed', async () => {
    const { fabric, instance } = await render(Host);
    const bar = fabric.find('RNSSearchBar');
    assert.ok(bar, 'the element is the native search bar itself');
    assert.equal(bar.props['placeholder'], 'Search');

    await fireEvent.changeText(bar, 'elm');

    const host = instance as { query(): string };
    assert.equal(host.query(), 'elm');
  });

  it('takes typing a key at a time, as a text field does', async () => {
    const { fabric, instance } = await render(Host);

    await userEvent.setup().type(fabric.find('RNSSearchBar')!, 'oak');

    assert.equal((instance as { query(): string }).query(), 'oak');
  });

  it('types the next key into the query the app put back with setText', async () => {
    const mod = await compileFixture('fixtures/search-bar.ts');
    const { fabric, instance } = await render(mod['SearchReset'] as Type<unknown>);

    await userEvent.type(fabric.find('RNSSearchBar')!, 'abcd');

    // `abc` is cleared, and `d` is typed into the empty field the app put back.
    assert.equal((instance as { query(): string }).query(), 'd');
  });

  it('types the next key into the field the app cleared with clearText', async () => {
    const mod = await compileFixture('fixtures/search-bar.ts');
    const { fabric, instance } = await render(mod['SearchClear'] as Type<unknown>);

    await userEvent.type(fabric.find('RNSSearchBar')!, 'abcd');

    assert.ok(
      fabric.commands.some((command) => command.name === 'clearText'),
      'control: the field is cleared with clearText',
    );
    assert.equal((instance as { query(): string }).query(), 'd');
  });

  it('is found by the placeholder it draws, as a text field is', async () => {
    const { fabric, instance } = await render(Host);

    const bar = screen.getByPlaceholderText('Search');
    assert.equal(bar, fabric.find('RNSSearchBar'));
    assert.equal(screen.queryByPlaceholderText('Find'), null);

    await userEvent.setup().type(bar, 'ash');
    assert.equal((instance as { query(): string }).query(), 'ash');
  });

  const commands = (fabric: { commands: { name: string; args: readonly unknown[] }[] }) =>
    fabric.commands.map((command) => [command.name, ...command.args]);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('puts a query set from code in the field, as a recent search tapped does', async () => {
    const { fabric, instance } = await render(Host);
    const host = instance as { query: { set(value: string): void } };
    host.query.set('maple');
    await settle();
    assert.deepEqual(commands(fabric), [['setText', 'maple']]);
  });

  it('puts a query the page starts with in the field', async () => {
    const mod = await compileFixture('fixtures/search-bar.ts');
    const { fabric } = await render(mod['SearchRestored'] as Type<unknown>);
    await settle();
    assert.deepEqual(commands(fabric), [['setText', 'oak']]);
  });

  it('sends nothing back for what the user typed', async () => {
    const { fabric } = await render(Host);
    await fireEvent.changeText(fabric.find('RNSSearchBar')!, 'elm');
    await settle();
    assert.deepEqual(commands(fabric), []);
  });

  it('reports a search, a cancel, and the field gaining and losing focus', async () => {
    const { fabric, instance } = await render(Host);
    const bar = fabric.find('RNSSearchBar')!;
    const host = instance as { submitted: string[]; cancelled: number; focused: boolean };
    await fireEvent(bar, 'searchFocus', {});
    assert.equal(host.focused, true);
    await fireEvent(bar, 'searchButtonPress', { text: 'birch' });
    assert.deepEqual(host.submitted, ['birch']);
    await fireEvent(bar, 'cancelButtonPress', {});
    assert.equal(host.cancelled, 1);
    await fireEvent(bar, 'searchBlur', {});
    assert.equal(host.focused, false);
  });

  it('focuses, blurs, clears and cancels the field from code', async () => {
    const { fabric, instance } = await render(Host);
    const bar = (
      instance as { bar(): { focus(): void; blur(): void; clear(): void; cancelSearch(): void } }
    ).bar();
    bar.focus();
    bar.blur();
    bar.clear();
    bar.cancelSearch();
    assert.deepEqual(commands(fabric), [['focus'], ['blur'], ['clearText'], ['cancelSearch']]);
  });
});

// On Android the open field covers the bar and react-native-screens hides the header's other
// items, which keep their bounds. React Native finds a touch's target by bounds alone, so a tap on
// the field pressed the item hidden under it (#1404).
describe('native search bar open in a header', () => {
  let Header: Type<unknown>;

  before(async () => {
    registerScreenComponents();
    const mod = await compileFixture('fixtures/search-bar.ts');
    Header = mod['SearchInHeader'] as Type<unknown>;
  });

  afterEach(() => cleanup());

  const touchable = (testID: string) =>
    screen.getByTestId(testID).props['pointerEvents'] !== 'none';

  it("keeps touches off the header's other items while the field is open", async () => {
    const { fabric } = await render(Header);
    const bar = fabric.find('RNSSearchBar')!;
    assert.equal(touchable('item'), true, 'control: the item takes touches before the field opens');

    await fireEvent(bar, 'open', {});
    assert.equal(touchable('item'), false);
    const field = fabric.find('RNSSearchBar')!;
    assert.notEqual(field.props['pointerEvents'], 'none', 'the field itself still takes touches');

    await fireEvent(bar, 'close', {});
    assert.equal(touchable('item'), true);
  });

  it('keeps touches off an item added while the field is open', async () => {
    const { fabric, instance, detectChanges } = await render(Header);
    await fireEvent(fabric.find('RNSSearchBar')!, 'open', {});

    (instance as { more: WritableSignal<boolean> }).more.set(true);
    await detectChanges();
    assert.equal(touchable('more'), false);
  });

  it('gives the items their touches back when the open field goes', async () => {
    const { fabric, instance, detectChanges } = await render(Header);
    await fireEvent(fabric.find('RNSSearchBar')!, 'open', {});

    (instance as { searchable: WritableSignal<boolean> }).searchable.set(false);
    await detectChanges();
    assert.equal(touchable('item'), true);
  });
});
