import { execFileSync } from 'node:child_process';
import { provideWebCompat } from '@ng-native/web-compat';
import { cleanup, render, screen, userEvent } from '@ng-native/testing';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { SpartanFeedback } from './spartan-feedback.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanFeedback, { globalStyles: tailwind as never, providers: [provideWebCompat()] });

const props = (id: string) => screen.getByTestId(id).props;

test('an alert is a bordered box that says it is one, with a title and a muted description', async () => {
  await mount();
  expect(props('alert')).toMatchObject({
    role: 'alert',
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: 'rgb(229, 231, 235)',
    borderTopLeftRadius: 10,
    paddingLeft: 16,
    paddingTop: 12,
    backgroundColor: 'rgb(255, 255, 255)',
  });
  expect(props('alert-title')).toMatchObject({ fontWeight: '500', color: 'rgb(3, 7, 18)' });
  expect(props('alert-description')).toMatchObject({ fontSize: 14, color: 'rgb(106, 114, 130)' });
});

test('a destructive alert is in the destructive colour', async () => {
  await mount();
  expect(props('destructive')).toMatchObject({ color: 'rgb(231, 0, 11)' });
});

// The description's colour is `*:data-[slot=alert-description]:text-destructive/90`: Tailwind's
// `*:` variant, which compiles to `:is(.alert > *)`.
test('a destructive alert tints its description too', async () => {
  await mount();
  expect(props('destructive-description')).toMatchObject({ color: 'rgba(231, 0, 11, 0.9)' });
});

test('a progress bar is a rounded track with an indicator moved back by what is left', async () => {
  await mount();
  expect(props('progress')).toMatchObject({
    role: 'progressbar',
    width: '100%',
    height: 6,
    overflow: 'hidden',
    backgroundColor: 'rgb(243, 244, 246)',
  });
  expect(props('indicator')).toMatchObject({
    backgroundColor: 'rgb(16, 24, 40)',
    transform: [{ translateX: '-60%' }],
  });
  await userEvent.press(screen.getByTestId('advance'));
  await vi.waitFor(() => expect(props('indicator')['transform']).toEqual([{ translateX: '-40%' }]));
});

test('a separator is a hairline across, or down', async () => {
  await mount();
  expect(props('separator')).toMatchObject({
    height: 1,
    width: '100%',
    backgroundColor: 'rgb(229, 231, 235)',
  });
  expect(props('vertical')).toMatchObject({ width: 1, backgroundColor: 'rgb(229, 231, 235)' });
});

test('a skeleton takes the size it is given, and pulses', async () => {
  await mount();
  expect(props('avatar')).toMatchObject({
    width: 40,
    height: 40,
    backgroundColor: 'rgb(243, 244, 246)',
  });
  expect(props('line')).toMatchObject({ width: 160, height: 16 });
  expect(props('line')['borderTopLeftRadius']).toBeCloseTo(8, 4);
  // The pulse: an opacity that is on its way somewhere.
  await vi.waitFor(() => expect(props('avatar')['opacity']).toBeLessThan(1));
});

// `rounded-full` beside the skeleton's own `rounded-md`, which is in the components layer and so
// under the utilities.
test('a skeleton takes the shape a utility gives it', async () => {
  await mount();
  expect(props('avatar')['borderTopLeftRadius']).toBeGreaterThan(20);
});
