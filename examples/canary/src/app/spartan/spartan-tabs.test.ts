import { execFileSync } from 'node:child_process';
import { provideWebCompat } from '@ng-native/web-compat';
import { cleanup, render, screen, userEvent, type FakeFabricNode } from '@ng-native/testing';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { SpartanTabs } from './spartan-tabs.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanTabs, { globalStyles: tailwind as never, providers: [provideWebCompat()] });

const hidden = { includeHiddenElements: true };
const props = (id: string) => screen.getByTestId(id, hidden).props;
const label = (id: string) => (screen.getByTestId(id, hidden).children[0] as FakeFabricNode).props;

test('the list is a rounded row as wide as its triggers, which share it equally', async () => {
  await mount();
  expect(props('list')).toMatchObject({
    role: 'tablist',
    flexDirection: 'row',
    alignItems: 'center',
    // `w-fit`: not stretched across the column the tabs are.
    alignSelf: 'flex-start',
    height: 36,
    paddingLeft: 3,
    backgroundColor: 'rgb(243, 244, 246)',
    borderTopLeftRadius: 10,
  });
  for (const id of ['account-tab', 'password-tab', 'billing-tab']) {
    expect(props(id), id).toMatchObject({ flexGrow: 1, flexBasis: '0%', paddingLeft: 8 });
  }
});

test('the active trigger is a white pill with full-strength text, and the others are dimmed', async () => {
  await mount();
  expect(props('account-tab')).toMatchObject({
    role: 'tab',
    accessibilityState: { selected: true },
    backgroundColor: 'rgb(255, 255, 255)',
  });
  expect(label('account-tab')).toMatchObject({
    color: 'rgb(3, 7, 18)',
    fontSize: 14,
    fontWeight: '500',
  });
  expect(props('password-tab')).toMatchObject({ accessibilityState: { selected: false } });
  expect(props('password-tab')['backgroundColor']).toBeUndefined();
  expect(label('password-tab')).toMatchObject({ color: 'rgba(3, 7, 18, 0.6)' });
});

test('only the active panel is laid out', async () => {
  await mount();
  expect(screen.getByText('Account settings.')).toBeTruthy();
  expect(screen.queryByText('Change your password.')).toBeNull();
  expect(props('account-panel')['display'] ?? null).toBeNull();
  expect(props('password-panel')['display']).toBe('none');
  expect(props('billing-panel')['display']).toBe('none');
});

test('a press on a trigger shows its panel and moves the pill', async () => {
  await mount();
  await userEvent.press(screen.getByTestId('password-tab'));
  expect(screen.getByText('Change your password.')).toBeTruthy();
  expect(screen.queryByText('Account settings.')).toBeNull();
  expect(props('password-tab')).toMatchObject({ accessibilityState: { selected: true } });
  await vi.waitFor(() =>
    expect(props('password-tab')['backgroundColor']).toBe('rgb(255, 255, 255)'),
  );
  await vi.waitFor(() => expect(props('account-tab')['backgroundColor'] ?? null).toBeNull());
});

test('a disabled trigger is dimmed and does nothing', async () => {
  await mount();
  expect(props('billing-tab')).toMatchObject({ opacity: 0.5, pointerEvents: 'none' });
  await userEvent.press(screen.getByTestId('billing-tab'));
  expect(screen.getByText('Account settings.')).toBeTruthy();
  expect(props('billing-panel')['display']).toBe('none');
});
