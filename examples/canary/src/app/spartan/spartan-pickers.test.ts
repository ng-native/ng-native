import { execFileSync } from 'node:child_process';
import { provideWebCompat } from '@ng-native/web-compat';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  settle,
  userEvent,
  type FakeFabricNode,
} from '@ng-native/testing';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { cdkInABrowser } from './cdk-platform.ts';
import { SpartanPickers } from './spartan-pickers.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanPickers, {
    globalStyles: tailwind as never,
    providers: [provideWebCompat(), cdkInABrowser],
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });

const all = (node: FakeFabricNode | undefined): FakeFabricNode[] =>
  node ? [node, ...node.children.flatMap(all)] : [];
const state = () => screen.getByTestId('picker-state').children[0]!.props['text'] as string;
const field = () =>
  all(screen.getByTestId('combobox-input')).find((node) => node.viewName === 'TextInput')!;
const shown = () => ['Angular', 'Analog', 'Astro', 'Next.js'].filter((n) => screen.queryByText(n));

test('a combobox lists its items when its field is focused, and filters them as you type', async () => {
  await mount();
  expect(field().props['placeholder']).toBe('Select a framework');
  expect(shown()).toEqual([]);
  await fireEvent.focus(field());
  await userEvent.type(field(), 'an', { skipBlur: true });
  await settle();
  expect(shown()).toEqual(['Angular', 'Analog']);
});

test('choosing a combobox item sets the value and closes the list', async () => {
  await mount();
  await fireEvent.focus(field());
  await userEvent.type(field(), 'as', { skipBlur: true });
  await settle();
  await userEvent.press(screen.getByText('Astro').parent!);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(state()).toContain('Framework: Astro');
  expect(field().props['text']).toBe('Astro');
  expect(screen.queryByText('Angular')).toBeNull();
});

test('a date picker opens a calendar from its trigger, and shows the day chosen', async () => {
  await mount();
  expect(screen.getByText('Pick a date')).toBeTruthy();
  await userEvent.press(screen.getByText('Pick a date').parent!);
  await settle();
  expect(screen.getByText('October 2026')).toBeTruthy();
  await userEvent.press(screen.getAllByText('15').at(-1)!.parent!);
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(state()).toContain('date: Thu Oct 15 2026');
  expect(screen.queryByText('Pick a date')).toBeNull();
});

test('a menubar opens the menu of the trigger pressed, and runs an item', async () => {
  await mount();
  expect(screen.getByTestId('menubar').props).toMatchObject({ flexDirection: 'row', height: 36 });
  await userEvent.press(screen.getByTestId('menubar-file'));
  await settle();
  expect(screen.getByText('New tab')).toBeTruthy();
  expect(screen.queryByText('Undo')).toBeNull();
  await userEvent.press(screen.getByText('Print').parent!);
  await settle();
  expect(state()).toContain('menu: print');
  expect(screen.queryByText('New tab')).toBeNull();
});
