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
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
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

/** A finger down on, or lifted from, a node: what Fabric sends for either. */
const touch = (node: FakeFabricNode, phase: 'Start' | 'End') => {
  const point = { identifier: 0, target: node.reactTag, pageX: 0, pageY: 0, timestamp: Date.now() };
  return fireEvent(node, `topTouch${phase}`, {
    ...point,
    touches: phase === 'Start' ? [point] : [],
    changedTouches: [point],
  });
};

test('a held button shows its pressed state, and loses it when the finger lifts', async () => {
  await mount();
  for (const [id, pressed] of [
    ['default', 'rgba(16, 24, 40, 0.8)'],
    ['destructive', 'rgba(231, 0, 11, 0.2)'],
    ['ghost', 'rgb(243, 244, 246)'],
  ] as const) {
    // No background at rest is a prop that is absent, and cleared again after a press.
    const rest = button(id).view['backgroundColor'] ?? null;
    await touch(screen.getByTestId(id), 'Start');
    // Spartan's `transition-all`: the colour is on its way for 150ms.
    await vi.waitFor(() => expect(button(id).view['backgroundColor'], id).toBe(pressed));
    expect(button(id).view['transform'], id).toContainEqual({ translateY: 1 });
    await touch(screen.getByTestId(id), 'End');
    await vi.waitFor(() => expect(button(id).view['backgroundColor'] ?? null, id).toBe(rest));
    expect(button(id).view['transform'] ?? [], id).not.toContainEqual({ translateY: 1 });
  }
});

test('a held disabled button shows no pressed state', async () => {
  await mount();
  await touch(screen.getByTestId('disabled'), 'Start');
  expect(button('disabled').view['transform'] ?? []).toEqual([]);
  await touch(screen.getByTestId('disabled'), 'End');
});

test('a focused button has its ring, as a keyboard or switch control shows it', async () => {
  await mount();
  expect(button('default').view['focusable']).toBe(true);
  await fireEvent(screen.getByTestId('default'), 'topFocus');
  await vi.waitFor(() =>
    expect(button('default').view).toMatchObject({
      borderTopColor: 'rgb(153, 161, 175)',
      boxShadow: [{ spreadDistance: 3, color: 'rgba(153, 161, 175, 0.5)' }],
    }),
  );
  await fireEvent(screen.getByTestId('default'), 'topBlur');
  await vi.waitFor(() => expect(button('default').view['borderTopColor']).toBe('rgba(0, 0, 0, 0)'));
});

test('a hovered button, under a pointer, has its hover colour', async () => {
  await mount();
  await fireEvent(screen.getByTestId('default'), 'topPointerEnter');
  await vi.waitFor(() =>
    expect(button('default').view['backgroundColor']).toBe('rgba(16, 24, 40, 0.8)'),
  );
  await fireEvent(screen.getByTestId('default'), 'topPointerLeave');
  await vi.waitFor(() => expect(button('default').view['backgroundColor']).toBe('rgb(16, 24, 40)'));
});
