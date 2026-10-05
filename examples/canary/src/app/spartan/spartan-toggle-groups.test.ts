import { execFileSync } from 'node:child_process';
import { provideWebCompat } from '@ng-native/web-compat';
import { cleanup, render, screen, settle, userEvent } from '@ng-native/testing';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { cdkInABrowser } from './cdk-platform.ts';
import { SpartanToggleGroups } from './spartan-toggle-groups.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanToggleGroups, {
    globalStyles: tailwind as never,
    providers: [provideWebCompat(), cdkInABrowser],
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });

const state = () => screen.getByTestId('group-state').children[0]!.props['text'];
const on = 'rgb(243, 244, 246)';
const hidden = { includeHiddenElements: true };

test('a single group has one item on, drawn as one joined control', async () => {
  await mount();
  expect(screen.getByTestId('group-single').props).toMatchObject({ flexDirection: 'row' });
  expect(screen.getByTestId('align-left').props).toMatchObject({
    backgroundColor: on,
    borderStartStartRadius: 8.00000011920929,
    borderTopRightRadius: 0,
  });
  expect(screen.getByTestId('align-center').props['backgroundColor']).not.toBe(on);
});

test('pressing another item of a single group moves the choice to it', async () => {
  await mount();
  await userEvent.press(screen.getByTestId('align-center'));
  await settle();
  expect(state()).toBe('Align: center, styles: none');
  expect(screen.getByTestId('align-center').props['backgroundColor']).toBe(on);
  expect(screen.getByTestId('align-left').props['backgroundColor']).not.toBe(on);
});

test('a disabled item is dimmed and cannot be chosen', async () => {
  await mount();
  expect(screen.getByTestId('align-right').props).toMatchObject({
    opacity: 0.5,
    pointerEvents: 'none',
  });
});

test('the items of a multiple group are each on or off, spaced apart', async () => {
  await mount();
  expect(screen.getByTestId('group-multiple').props).toMatchObject({ columnGap: 8 });
  await userEvent.press(screen.getByTestId('style-bold'));
  await userEvent.press(screen.getByTestId('style-italic'));
  await settle();
  expect(state()).toBe('Align: left, styles: bold italic');
  await userEvent.press(screen.getByTestId('style-bold'));
  await settle();
  expect(state()).toBe('Align: left, styles: italic');
  expect(screen.getByTestId('style-italic').props['backgroundColor']).toBe(on);
});

test('a collapsible hides its content until its trigger is pressed, and again after', async () => {
  await mount();
  expect(screen.queryByTestId('collapsible-content')).toBeNull();
  expect(screen.getByTestId('collapsible-content', hidden).props['display']).toBe('none');
  await userEvent.press(screen.getByTestId('collapsible-trigger'));
  await settle();
  expect(screen.getByText('The details, shown when it is open.')).toBeTruthy();
  await userEvent.press(screen.getByTestId('collapsible-trigger'));
  await settle();
  expect(screen.queryByTestId('collapsible-content')).toBeNull();
});
