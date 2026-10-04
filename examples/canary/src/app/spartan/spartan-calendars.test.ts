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
import { afterEach, beforeAll, expect, test } from 'vitest';
import { cdkInABrowser } from './cdk-platform.ts';
import { SpartanCalendars } from './spartan-calendars.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanCalendars, {
    globalStyles: tailwind as never,
    providers: [provideWebCompat(), cdkInABrowser],
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });

const all = (node: FakeFabricNode | undefined): FakeFabricNode[] =>
  node ? [node, ...node.children.flatMap(all)] : [];
const chosen = () => screen.getByTestId('calendar-state').children[0]!.props['text'];
const having = (attribute: string) =>
  all(screen.getByTestId('calendar')).find((node) => attribute in node.props)!;
/** The day's button: the text's parent, in the month being shown and not a neighbour's. */
const day = (label: string) => screen.getAllByText(label).at(-1)!.parent!;

test('a calendar shows the month it is given, a week to a row', async () => {
  await mount();
  expect(screen.getByText('October 2026')).toBeTruthy();
  expect(screen.getByText('Su', { includeHiddenElements: true }).props['color']).toBe(
    'rgb(106, 114, 130)',
  );
  const week = day('15').parent!.parent!;
  expect(week.props).toMatchObject({ flexDirection: 'row' });
  expect(week.children).toHaveLength(7);
});

test('pressing a day chooses it, and draws it as the chosen one', async () => {
  await mount();
  expect(chosen()).toBe('Chosen: nothing');
  await userEvent.press(day('15'));
  await settle();
  expect(chosen()).toBe('Chosen: Thu Oct 15 2026');
  // The colour is a transition from the pressed one.
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(day('15').props['backgroundColor']).toBe('rgb(16, 24, 40)');
  expect(day('16').props['backgroundColor']).not.toBe('rgb(16, 24, 40)');
});

test('the next and previous buttons move a month at a time', async () => {
  await mount();
  await userEvent.press(having('brnCalendarNextButton'));
  await settle();
  expect(screen.getByText('November 2026')).toBeTruthy();
  await userEvent.press(having('brnCalendarPreviousButton'));
  await userEvent.press(having('brnCalendarPreviousButton'));
  await settle();
  expect(screen.getByText('September 2026')).toBeTruthy();
});
