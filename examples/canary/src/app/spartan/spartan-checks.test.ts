import { execFileSync } from 'node:child_process';
import { provideWebCompat } from '@ng-native/web-compat';
import { cleanup, render, screen, userEvent, type FakeFabricNode } from '@ng-native/testing';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { SpartanChecks } from './spartan-checks.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanChecks, { globalStyles: tailwind as never, providers: [provideWebCompat()] });

/** The pressable box of a checkbox or switch: the button its host wraps. */
const box = (id: string): FakeFabricNode => {
  const find = (node: FakeFabricNode): FakeFabricNode | undefined =>
    node.props['accessibilityRole'] === 'button' ? node : node.children.map(find).find(Boolean);
  return find(screen.getByTestId(id))!;
};

// Fails with the test below it, and for the same reason: the focus ring's border is on.
test.fails(
  'a checkbox is a small bordered box that says what it is and whether it is checked',
  async () => {
    await mount();
    expect(box('terms').props).toMatchObject({
      role: 'checkbox',
      accessibilityState: { checked: false },
      width: 16,
      height: 16,
      borderTopWidth: 1,
      borderTopLeftRadius: 4,
      alignItems: 'center',
      justifyContent: 'center',
    });
    expect(box('terms').props['backgroundColor']).toBeUndefined();
    expect(box('checked').props).toMatchObject({
      accessibilityState: { checked: true },
      backgroundColor: 'rgb(16, 24, 40)',
      borderTopColor: 'rgb(16, 24, 40)',
    });
  },
);

test('a press checks a checkbox, and another unchecks it', async () => {
  await mount();
  await userEvent.press(box('terms'));
  expect(screen.getByText('Terms: true, wifi: false')).toBeTruthy();
  expect(box('terms').props).toMatchObject({
    accessibilityState: { checked: true },
    backgroundColor: 'rgb(16, 24, 40)',
  });
  await userEvent.press(box('terms'));
  expect(screen.getByText('Terms: false, wifi: false')).toBeTruthy();
  expect(box('terms').props['backgroundColor'] ?? null).toBeNull();
});

// Fails with the test below it, and for the same reason: the focus ring's border is on.
test.fails('a switch is a pill with a round thumb that slides when it is on', async () => {
  await mount();
  expect(box('wifi').props).toMatchObject({
    role: 'switch',
    accessibilityState: { checked: false },
    width: 32,
    height: 18.4,
    backgroundColor: 'rgb(229, 231, 235)',
    flexDirection: 'row',
    alignItems: 'center',
  });
  const thumb = (id: string) => box(id).children[0]!.props;
  expect(thumb('wifi')).toMatchObject({
    width: 16,
    height: 16,
    backgroundColor: 'rgb(255, 255, 255)',
  });
  expect(thumb('wifi')['transform']).toContainEqual({ translateX: 0 });
  expect(box('on').props).toMatchObject({ backgroundColor: 'rgb(16, 24, 40)' });
  // `translate-x-[calc(100%-2px)]`, of a 16 point thumb.
  expect(thumb('on')['transform']).toContainEqual({ translateX: 14 });
});

test('a press turns a switch on', async () => {
  await mount();
  await userEvent.press(box('wifi'));
  expect(screen.getByText('Terms: false, wifi: true')).toBeTruthy();
  await vi.waitFor(() => expect(box('wifi').props['backgroundColor']).toBe('rgb(16, 24, 40)'));
});

test('a disabled checkbox or switch is dimmed and does not change', async () => {
  await mount();
  for (const id of ['disabled-check', 'disabled-switch']) {
    await userEvent.press(box(id));
    expect(box(id).props, id).toMatchObject({ accessibilityState: { checked: false } });
  }
  expect(box('disabled-check').props['opacity']).toBe(0.5);
});

// Fails until the presets read `data-focus="false"` and `data-disabled="false"` as off, which is
// how Spartan's primitives write a state that is off. When they do, this passes and `fails` flags it.
test.fails('an enabled, unfocused checkbox or switch is neither dimmed nor ringed', async () => {
  await mount();
  for (const id of ['terms', 'wifi']) {
    expect(box(id).props['opacity'], id).toBeUndefined();
    const shadows = (box(id).props['boxShadow'] ?? []) as { spreadDistance: number }[];
    expect(
      shadows.some((shadow) => shadow.spreadDistance === 3),
      id,
    ).toBe(false);
  }
});
