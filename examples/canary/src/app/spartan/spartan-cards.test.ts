import { execFileSync } from 'node:child_process';
import { provideWebCompat } from '@ng-native/web-compat';
import { cleanup, render, screen } from '@ng-native/testing';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { SpartanCards } from './spartan-cards.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanCards, { globalStyles: tailwind as never, providers: [provideWebCompat()] });

const props = (id: string) => screen.getByTestId(id).props;

test('a card is a white rounded box with a hairline ring and a soft shadow', async () => {
  await mount();
  expect(props('card')).toMatchObject({
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: 'rgb(255, 255, 255)',
    paddingTop: 24,
    paddingBottom: 24,
    rowGap: 24,
    boxShadow: [
      { spreadDistance: 1, blurRadius: 0, color: 'rgba(3, 7, 18, 0.1)' },
      { offsetY: 1, blurRadius: 2, color: 'rgba(0, 0, 0, 0.05)' },
    ],
  });
  // `rounded-xl`, 1.4 times a radius of 10.
  expect(props('card')['borderTopLeftRadius']).toBeCloseTo(14, 4);
});

test('its parts are inset by the card spacing, with the header closing up its lines', async () => {
  await mount();
  for (const id of ['header', 'content', 'footer']) {
    expect(props(id), id).toMatchObject({ paddingLeft: 24, paddingRight: 24 });
  }
  expect(props('header')).toMatchObject({ rowGap: 4 });
  expect(props('footer')).toMatchObject({ flexDirection: 'row', alignItems: 'center' });
});

test('the title is a heading, and the description is muted', async () => {
  await mount();
  expect(props('title')).toMatchObject({
    accessibilityRole: 'header',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
    color: 'rgb(3, 7, 18)',
  });
  expect(props('description')).toMatchObject({
    fontSize: 14,
    lineHeight: 20,
    color: 'rgb(106, 114, 130)',
  });
});

test('a small card has the smaller spacing and title', async () => {
  await mount();
  expect(props('small')).toMatchObject({ paddingTop: 16, paddingBottom: 16, rowGap: 16 });
  expect(props('small-title')).toMatchObject({ fontSize: 14 });
});

test('a button in the footer keeps its own shape', async () => {
  await mount();
  expect(props('save')['borderTopLeftRadius']).toBeCloseTo(8, 4);
  expect(props('save')).toMatchObject({ height: 36, backgroundColor: 'rgb(16, 24, 40)' });
});
