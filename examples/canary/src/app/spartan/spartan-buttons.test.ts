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
import { SpartanButtons } from './spartan-buttons.ts';

let tailwind: unknown;
beforeAll(async () => {
  // The app's Tailwind sheet, generated as Metro's config generates it at startup.
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanButtons, { globalStyles: tailwind as never, providers: [provideWebCompat()] });

/** A button's committed props, and its label's. */
const button = (id: string) => {
  const view = screen.getByTestId(id);
  return { view: view.props, label: (view.children[0] as FakeFabricNode).props };
};

const PRIMARY = 'rgb(16, 24, 40)';
const PRIMARY_FOREGROUND = 'rgb(249, 250, 251)';

test('a button is an accessible view, laid out as a centred row', async () => {
  await mount();
  const { view, label } = button('default');
  expect(screen.getByTestId('default').viewName).toBe('View');
  expect(view).toMatchObject({
    accessibilityRole: 'button',
    accessible: true,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    height: 36,
    paddingLeft: 10,
    paddingRight: 10,
    columnGap: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0)',
    backgroundColor: PRIMARY,
  });
  expect(view['borderTopLeftRadius']).toBeCloseTo(8, 4);
  expect(label).toMatchObject({ color: PRIMARY_FOREGROUND, fontSize: 14, fontWeight: '500' });
  expect(screen.getByText('Default')).toBeTruthy();
});

test('each variant has its own colours', async () => {
  await mount();
  expect(button('secondary')).toMatchObject({
    view: { backgroundColor: 'rgb(243, 244, 246)' },
    label: { color: PRIMARY },
  });
  expect(button('outline').view).toMatchObject({
    backgroundColor: 'rgb(255, 255, 255)',
    borderTopColor: 'rgb(229, 231, 235)',
    boxShadow: [{ offsetY: 1, blurRadius: 2, color: 'rgba(0, 0, 0, 0.05)' }],
  });
  expect(button('destructive')).toMatchObject({
    view: { backgroundColor: 'rgba(231, 0, 11, 0.1)' },
    label: { color: 'rgb(231, 0, 11)' },
  });
  expect(button('ghost').view['backgroundColor']).toBeUndefined();
  expect(button('link')).toMatchObject({ label: { color: PRIMARY } });
  expect(button('link').view['backgroundColor']).toBeUndefined();
});

test('each size has its own height, padding, gap, text and radius', async () => {
  await mount();
  expect(button('xs')).toMatchObject({
    view: { height: 24, paddingLeft: 8, columnGap: 4 },
    label: { fontSize: 12 },
  });
  expect(button('sm').view).toMatchObject({ height: 32, paddingLeft: 10, columnGap: 4 });
  expect(button('lg').view).toMatchObject({ height: 40, paddingLeft: 10, columnGap: 6 });
  // `min(var(--radius-md), 8px)` and `min(var(--radius-md), 10px)`, with a radius of 8.
  for (const id of ['xs', 'sm', 'lg'])
    expect(button(id).view['borderTopLeftRadius']).toBeCloseTo(8, 4);
});

test('a disabled button is dimmed and takes no touches', async () => {
  await mount();
  expect(button('disabled').view).toMatchObject({ opacity: 0.5, pointerEvents: 'none' });
});

test('a press on a button is its click, and a disabled one hears nothing', async () => {
  await mount();
  await userEvent.press(screen.getByTestId('default'));
  await userEvent.press(screen.getByTestId('outline'));
  expect(screen.getByText('Presses: 2')).toBeTruthy();
  await userEvent.press(screen.getByTestId('disabled'));
  expect(screen.getByText('Presses: 2')).toBeTruthy();
});
