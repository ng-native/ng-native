import { RendererFactory2 } from '@angular/core';
import { render, screen, settle, type FakeFabricNode, type RenderResult } from '@ng-native/testing';
import { ColorScheme, type Scheme } from '@ng-native/device';
import { expect } from 'vitest';
import { check, parentOf } from '../../check.ts';
import { App } from './solution/app.ts';
import { HabitRow } from './solution/habit-row.ts';

/** What `ColorScheme` reports on a phone set to `scheme`. */
const schemeIs = (scheme: Scheme) => [
  { provide: ColorScheme.SOURCE, useValue: { current: () => scheme, subscribe: () => () => {} } },
];

/**
 * Restyle a render as if it were on `platform`: swap the class `mount()` puts on the root, which
 * is all that `ios:` and `android:` match, so one run can compare the two. The root is the parent
 * of the component's host. Inside a render pass, so the change commits at its end as any other
 * would.
 */
function asPlatform(result: RenderResult<unknown>, platform: 'ios' | 'android'): void {
  const factory = result.componentRef.injector.get(RendererFactory2);
  const renderer = factory.createRenderer(null, null);
  const root = renderer.parentNode(result.componentRef.location.nativeElement) as unknown;
  factory.begin?.();
  renderer.removeClass(root, 'platform-ios');
  renderer.removeClass(root, 'platform-android');
  renderer.addClass(root, 'platform-' + platform);
  factory.end?.();
}

/** A text's own props and its row's, as they are committed now. */
const looks = (roots: readonly FakeFabricNode[], text: string) => {
  const node = screen.getByText(text);
  return { text: node.props, row: parentOf(roots, node)?.props };
};

check(
  1,
  'The screen is styled with Tailwind, not a stylesheet',
  async ({ file }) => {
    expect(file('app.ts')).not.toMatch(/styles\s*:/);
    const { fabric } = await render(App);
    const title = screen.getByText('Today');
    expect(title.props['fontSize']).toBeGreaterThanOrEqual(24);
    // Set either way: bold on iOS, and android:font-medium on Android.
    expect(title.props['fontWeight']).toBeDefined();
    const screenView = parentOf(fabric.committed, title);
    expect(screenView?.props['backgroundColor']).toBeDefined();
    expect(screenView?.props['rowGap']).toBeGreaterThan(0);
  },
  'Remove styles from app.ts, and give its elements classes: flex-1 gap-2 bg-zinc-100 px-5 pt-safe on the view, text-3xl font-bold on the title.',
  { readsStyles: true },
);

check(
  2,
  'The row is styled with Tailwind too',
  async ({ file }) => {
    expect(file('habit-row.ts')).not.toMatch(/styles\s*:/);
    const { fabric } = await render(HabitRow, { inputs: { name: 'Stretch' } });
    const row = parentOf(fabric.committed, screen.getByText('Stretch'));
    expect(row?.props['flexDirection']).toBe('row');
    expect(row?.props['justifyContent']).toBe('space-between');
    expect(row?.props['borderTopLeftRadius']).toBeGreaterThan(0);
  },
  'Remove styles from habit-row.ts, and give the pressable flex-row justify-between rounded-xl bg-white p-4 active:bg-zinc-200.',
  { readsStyles: true },
);

check(
  2,
  'The row changes color while it is touched',
  async () => {
    const { fabric } = await render(HabitRow, { inputs: { name: 'Stretch' } });
    const row = () => parentOf(fabric.committed, screen.getByText('Stretch'))!;
    const resting = row().props['backgroundColor'];
    fabric.emit(screen.getByText('Stretch'), 'topTouchStart', {
      touches: [{}],
      changedTouches: [{}],
    });
    await settle();
    expect(row().props['backgroundColor']).not.toEqual(resting);
    fabric.emit(screen.getByText('Stretch'), 'topTouchEnd', { touches: [], changedTouches: [{}] });
    await settle();
    expect(row().props['backgroundColor']).toEqual(resting);
  },
  'Give the pressable active:bg-zinc-200, which applies while a finger is on it.',
  { readsStyles: true },
);

check(
  3,
  'The title and the count look different on iOS and on Android',
  async () => {
    const result = await render(App);
    asPlatform(result, 'ios');
    const ios = [
      looks(result.fabric.committed, 'Today'),
      looks(result.fabric.committed, '2 left to do'),
    ];
    asPlatform(result, 'android');
    const android = [
      looks(result.fabric.committed, 'Today'),
      looks(result.fabric.committed, '2 left to do'),
    ];
    expect(android.map((look) => look.text)).not.toEqual(ios.map((look) => look.text));
  },
  'Add an ios: class and an android: class to the title or the count, such as android:text-2xl on the title and ios:uppercase on the count.',
  { readsStyles: true },
);

check(
  3,
  'The row has squarer corners on Android',
  async () => {
    const result = await render(HabitRow, { inputs: { name: 'Stretch' } });
    asPlatform(result, 'ios');
    const ios = looks(result.fabric.committed, 'Stretch').row?.['borderTopLeftRadius'];
    asPlatform(result, 'android');
    const android = looks(result.fabric.committed, 'Stretch').row?.['borderTopLeftRadius'];
    expect(android).toBeLessThan(ios as number);
  },
  'Add android:rounded-md to the pressable in habit-row.ts.',
  { readsStyles: true },
);

check(
  4,
  'The screen follows the phone into dark mode',
  async () => {
    const { fabric: light } = await render(App, { providers: schemeIs('light') });
    const lightTitle = screen.getByText('Today').props['color'];
    const lightScreen = parentOf(light.committed, screen.getByText('Today'))?.props[
      'backgroundColor'
    ];
    const lightRow = parentOf(light.committed, screen.getByText('Drink water'))?.props[
      'backgroundColor'
    ];
    const { fabric: dark } = await render(App, { providers: schemeIs('dark') });
    expect(screen.getByText('Today').props['color']).not.toEqual(lightTitle);
    const darkScreen = parentOf(dark.committed, screen.getByText('Today'))?.props[
      'backgroundColor'
    ];
    expect(darkScreen).not.toEqual(lightScreen);
    const darkRow = parentOf(dark.committed, screen.getByText('Drink water'))?.props[
      'backgroundColor'
    ];
    expect(darkRow).not.toEqual(lightRow);

    // And live: the phone switching scheme under a running app restyles it in place.
    let scheme: Scheme = 'light';
    let listener: (next: Scheme) => void = () => {};
    const { fabric: live } = await render(App, {
      providers: [
        {
          provide: ColorScheme.SOURCE,
          useValue: {
            current: () => scheme,
            subscribe: (next: typeof listener) => ((listener = next), () => {}),
          },
        },
      ],
    });
    scheme = 'dark';
    listener('dark');
    await settle();
    expect(parentOf(live.committed, screen.getByText('Today'))?.props['backgroundColor']).toEqual(
      darkScreen,
    );
  },
  "Inject ColorScheme, put host: { '[class.dark]': 'dark()' } on App, and add dark: classes: dark:bg-black on the screen, dark:text-white on the title and dark:bg-zinc-900 on the row.",
  { readsStyles: true },
);
