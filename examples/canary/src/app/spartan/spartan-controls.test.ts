import { execFileSync } from 'node:child_process';
import { provideWebCompat } from '@ng-native/web-compat';
import { cleanup, render, screen, userEvent, type FakeFabricNode } from '@ng-native/testing';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { SpartanControls } from './spartan-controls.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanControls, { globalStyles: tailwind as never, providers: [provideWebCompat()] });

const props = (id: string) => screen.getByTestId(id).props;
const find = (
  node: FakeFabricNode,
  test: (node: FakeFabricNode) => boolean,
): FakeFabricNode | undefined =>
  test(node) ? node : node.children.map((child) => find(child, test)).find(Boolean);

test('a toggle is a button that is pressed or not, and a press flips it', async () => {
  await mount();
  expect(props('bold')).toMatchObject({
    accessibilityRole: 'button',
    height: 36,
    minWidth: 36,
    paddingLeft: 10,
    backgroundColor: 'rgba(0, 0, 0, 0)',
  });
  await userEvent.press(screen.getByTestId('bold'));
  expect(screen.getByText('Bold: true, plan: free')).toBeTruthy();
  await vi.waitFor(() => expect(props('bold')['backgroundColor']).toBe('rgb(243, 244, 246)'));
  await userEvent.press(screen.getByTestId('bold'));
  expect(screen.getByText('Bold: false, plan: free')).toBeTruthy();
});

test('an outline toggle has a border, and a disabled one is dimmed and does nothing', async () => {
  await mount();
  expect(props('italic')).toMatchObject({
    borderTopWidth: 1,
    borderTopColor: 'rgb(229, 231, 235)',
  });
  expect(props('disabled-toggle')).toMatchObject({ opacity: 0.5, pointerEvents: 'none' });
});

test('a radio group has one option chosen, and a press on another chooses it', async () => {
  await mount();
  expect(props('plans')).toMatchObject({ role: 'radiogroup', rowGap: 12 });
  // The dot of the chosen option is filled, and the other's is clear.
  const dot = (id: string) =>
    find(
      screen.getByTestId(id),
      (node) => node.props['width'] === 8 && node.props['height'] === 8,
    )!;
  expect(dot('free').props['backgroundColor']).toBe('rgb(16, 24, 40)');
  expect(dot('pro').props['backgroundColor']).toBe('rgba(0, 0, 0, 0)');
  // The radio itself, which brain numbers: `brn-radio-3`, and not the input it keeps beside it.
  const radio = find(screen.getByTestId('pro'), (node) =>
    /^brn-radio-\d+$/.test(String(node.props['nativeID'])),
  )!;
  // Its circle, which is what a finger lands on. The label's text does not choose it yet.
  await userEvent.press(radio.children[0] as FakeFabricNode);
  expect(screen.getByText('Bold: false, plan: pro')).toBeTruthy();
});

test('the input a radio keeps out of sight is not a text field', async () => {
  await mount();
  const hidden = find(screen.getByTestId('free'), (node) => node.props['type'] === 'radio')!;
  expect(hidden.viewName).toBe('View');
});

test('a textarea is a bordered field of several lines, at least four lines tall', async () => {
  await mount();
  expect(screen.getByTestId('notes').viewName).toMatch(/TextInput$/);
  expect(props('notes')).toMatchObject({
    multiline: true,
    placeholder: 'Notes',
    minHeight: 64,
    width: '100%',
    borderTopWidth: 1,
    paddingLeft: 10,
    paddingTop: 8,
    placeholderTextColor: 'rgb(106, 114, 130)',
  });
});

test('an avatar is a circle with its initials centred in it', async () => {
  await mount();
  expect(props('avatar')).toMatchObject({ width: 32, height: 32 });
  expect(props('avatar')['borderTopLeftRadius']).toBeGreaterThan(16);
  expect(props('large-avatar')).toMatchObject({ width: 40, height: 40 });
  expect(props('fallback')).toMatchObject({
    backgroundColor: 'rgb(243, 244, 246)',
    color: 'rgb(106, 114, 130)',
    alignItems: 'center',
    justifyContent: 'center',
  });
  expect(screen.getByText('AH')).toBeTruthy();
});
