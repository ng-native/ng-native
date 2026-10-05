import { execFileSync } from 'node:child_process';
import { provideWebCompat } from '@ng-native/web-compat';
import {
  cleanup,
  render,
  screen,
  settle,
  userEvent,
  type FakeFabricNode,
} from '@ng-native/testing';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { cdkInABrowser } from './cdk-platform.ts';
import { SpartanMenus } from './spartan-menus.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanMenus, {
    globalStyles: tailwind as never,
    providers: [provideWebCompat(), cdkInABrowser],
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });

const all = (node: FakeFabricNode | undefined): FakeFabricNode[] =>
  node ? [node, ...node.children.flatMap(all)] : [];
const open = async () => {
  await userEvent.press(screen.getByTestId('menu-trigger'));
  await settle();
};
const state = () => all(screen.getByTestId('menu-state')).at(-1)!.props['text'];

test("a menu opens under its trigger, at the trigger's left edge", async () => {
  const app = await mount();
  app.fabric.frames.set('menu-trigger', { x: 16, y: 300, width: 110, height: 36 });
  expect(screen.queryByText('Profile')).toBeNull();
  await open();
  expect(screen.getByTestId('menu').props).toMatchObject({
    width: 224,
    backgroundColor: 'rgb(255, 255, 255)',
  });
  expect(screen.getByText('My account').props['color']).toBe('rgb(106, 114, 130)');
  const pane = all(app.fabric.committed[1]).find((node) => node.props['top'] === 336);
  expect(pane?.props).toMatchObject({ position: 'absolute', top: 336, left: 16 });
});

test('choosing an item runs it and closes the menu', async () => {
  await mount();
  await open();
  await userEvent.press(screen.getByTestId('menu-profile'));
  await settle();
  expect(state()).toBe('Last: profile, status bar: false');
  expect(screen.queryByText('Profile')).toBeNull();
});

test('a disabled item is dimmed and takes no press', async () => {
  await mount();
  await open();
  expect(screen.getByTestId('menu-billing').props).toMatchObject({
    opacity: 0.5,
    pointerEvents: 'none',
  });
});

test('a destructive item is drawn in the destructive colour', async () => {
  await mount();
  await open();
  expect(screen.getByText('Delete').props['color']).toBe('rgb(231, 0, 11)');
});

test('a checkbox item is ticked when pressed, and leaves the menu open', async () => {
  await mount();
  await open();
  const tick = () => all(screen.getByTestId('menu-status')).find((n) => 'end' in n.props)!;
  expect(tick().props['opacity']).toBe(0);
  await userEvent.press(screen.getByTestId('menu-status'));
  await settle();
  expect(state()).toBe('Last: nothing, status bar: true');
  expect(screen.getByText('Status bar')).toBeTruthy();
  expect(tick().props['opacity'] ?? 1).toBe(1);
});

test('a press outside the menu closes it', async () => {
  await mount();
  await open();
  await userEvent.press(screen.getByTestId('menu-state'));
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(screen.queryByText('Profile')).toBeNull();
  expect(state()).toBe('Last: nothing, status bar: false');
});
