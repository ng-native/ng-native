import { execFileSync } from 'node:child_process';
import { provideWebCompat } from '@ng-native/web-compat';
import { cleanup, fireEvent, render, screen, settle } from '@ng-native/testing';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { cdkInABrowser } from './cdk-platform.ts';
import { SpartanSliders } from './spartan-sliders.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanSliders, {
    globalStyles: tailwind as never,
    providers: [provideWebCompat(), cdkInABrowser],
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });

/** One finger on the screen, as native reports a touch. */
const finger = (pageX: number, down = true) => {
  const point = { identifier: 0, pageX, pageY: 103, locationX: 0, locationY: 0 };
  return { ...point, touches: down ? [point] : [], changedTouches: [point] };
};
const parts = (id: string) => {
  const [track, ...thumbs] = screen.getByTestId(id).children[0]!.children;
  return { track: track!, range: track!.children[0]!, thumbs };
};
const volume = () => screen.getByTestId('slider-state').children[0]!.props['text'];

/** Mount with the track laid out from 20 to 220 across the screen, and each thumb measured. */
async function laidOut() {
  const app = await mount();
  app.fabric.frames.set('View', { x: 20, y: 100, width: 200, height: 6 });
  for (const id of ['slider', 'slider-range', 'slider-disabled']) {
    for (const thumb of parts(id).thumbs) await fireEvent.layout(thumb, { width: 16, height: 16 });
  }
  return app;
}

test('a slider fills its track up to its value, with the thumb there', async () => {
  await laidOut();
  const { track, range, thumbs } = parts('slider');
  expect(track.props).toMatchObject({ height: 6, backgroundColor: 'rgb(243, 244, 246)' });
  expect(range.props).toMatchObject({ start: 0, end: '70%', backgroundColor: 'rgb(16, 24, 40)' });
  expect(thumbs).toHaveLength(1);
  // 30% along, less the part of its own width that keeps it inside the track at either end.
  expect(thumbs[0]!.props).toMatchObject({ start: '30%', marginStart: 3.2, width: 16 });
  expect(thumbs[0]!.props['opacity'] ?? 1).toBe(1);
  expect(thumbs[0]!.props['accessibilityValue']).toEqual({ min: 0, max: 100, now: 30 });
});

test('a thumb is not drawn until it has been measured', async () => {
  await mount();
  expect(parts('slider').thumbs[0]!.props).toMatchObject({ opacity: 0, pointerEvents: 'none' });
});

test('a touch on the track moves the value there, and a drag takes it along in steps', async () => {
  await laidOut();
  const { track } = parts('slider');
  await fireEvent(track, 'touchStart', finger(120));
  expect(volume()).toBe('Volume: 50');
  await fireEvent(track, 'touchMove', finger(163));
  expect(volume()).toBe('Volume: 70');
  await fireEvent(track, 'touchMove', finger(400));
  expect(volume()).toBe('Volume: 100');
  await fireEvent(track, 'touchEnd', finger(400, false));
  expect(parts('slider').range.props).toMatchObject({ start: 0, end: '0%' });
});

test('a thumb is dragged from where it is', async () => {
  await laidOut();
  const thumb = parts('slider').thumbs[0]!;
  await fireEvent(thumb, 'touchStart', finger(80));
  expect(volume()).toBe('Volume: 30');
  await fireEvent(thumb, 'touchMove', finger(41));
  await fireEvent(thumb, 'touchEnd', finger(41, false));
  expect(volume()).toBe('Volume: 10');
});

test('a slider with two values fills between its thumbs', async () => {
  await laidOut();
  const { range, thumbs } = parts('slider-range');
  expect(thumbs).toHaveLength(2);
  expect(range.props).toMatchObject({ start: '25%', end: '25%' });
});

test('a disabled slider is dimmed and does not move', async () => {
  await laidOut();
  expect(screen.getByTestId('slider-disabled').props).toMatchObject({
    opacity: 0.5,
    pointerEvents: 'none',
  });
  const { track, range } = parts('slider-disabled');
  await fireEvent(track, 'touchStart', finger(200));
  await fireEvent(track, 'touchEnd', finger(200, false));
  expect(range.props).toMatchObject({ end: '60%' });
});
