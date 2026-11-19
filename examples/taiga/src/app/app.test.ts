import { execFileSync } from 'node:child_process';
import { cleanup, render, screen, settle, userEvent } from '@ng-native/testing';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { App } from './app.ts';
import { appConfig } from './app.config.ts';

let sheet: unknown;
beforeAll(async () => {
  // The global sheet with Taiga's theme, generated as Metro's config does. What the theme says
  // that native has no answer for (hover, ::before, :invalid) is warned about at length.
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe', maxBuffer: 2 ** 26 });
  sheet = (await import('../../.angular-native/app.tailwind.js')).default;
});
afterEach(() => cleanup());

async function start() {
  await render(App, { globalStyles: sheet as never, ...appConfig });
  // The router shows the screen once its first navigation ends.
  await screen.findByText('Profile', undefined, { timeout: 10_000 });
  await settle();
}

async function press(target: Parameters<typeof userEvent.press>[0]) {
  await userEvent.press(target);
  await settle();
}

async function fillProfile(name: string, email: string) {
  const user = userEvent.setup();
  await user.type(screen.getByTestId('profile-name'), name);
  await user.type(screen.getByTestId('profile-email'), email);
  await settle();
}

const saveButton = () => screen.getByRole('button', { name: 'Save' });

test('text is set in Manrope, in the weight Taiga gives it', async () => {
  await start();
  expect(screen.getByText('Save').props['fontFamily']).toBe('Manrope-700');
  expect(screen.getByText('I agree to the terms').props['fontFamily']).toBe('Manrope-400');
});

test('an inline notification says what the email is for', async () => {
  await start();
  expect(screen.getByText('Your email is only used to sign in.')).toBeTruthy();
});

test('the text fields take typing, and Save waits for a name, an email and the terms', async () => {
  await start();
  expect(saveButton().props['accessibilityState']).toMatchObject({ disabled: true });
  await fillProfile('Ada', 'ada@example.com');
  expect(screen.getByTestId('profile-name').props['text']).toBe('Ada');
  expect(saveButton().props['accessibilityState']).toMatchObject({ disabled: true });
  await press(screen.getByTestId('profile-terms'));
  await vi.waitFor(() =>
    expect(saveButton().props['accessibilityState']).not.toMatchObject({ disabled: true }),
  );
});

test('the checkbox and the switch show what they hold', async () => {
  await start();
  const fill = (id: string) => screen.getByTestId(id).props['backgroundColor'];
  const terms = fill('profile-terms');
  const news = fill('profile-news');
  await press(screen.getByTestId('profile-terms'));
  await press(screen.getByTestId('profile-news'));
  await vi.waitFor(() => expect(fill('profile-terms')).not.toBe(terms));
  await vi.waitFor(() => expect(fill('profile-news')).not.toBe(news));
  // A box in a label sits half a line down, and is lifted by half its height onto the line.
  expect(screen.getByTestId('profile-terms').props['top']).toBeCloseTo(11.2);
});

test('Save shows an alert, which says what the switch chose', async () => {
  await start();
  await fillProfile('Ada', 'ada@example.com');
  await press(screen.getByTestId('profile-terms'));
  await press(screen.getByTestId('profile-news'));
  await press(saveButton());
  await vi.waitFor(() => expect(screen.getByText('Saved, Ada')).toBeTruthy());
  expect(screen.getByText('No news emails.')).toBeTruthy();
});

test('the badge names the plan, and the dropdown changes it', async () => {
  await start();
  expect(screen.getByTestId('plan-badge')).toBeTruthy();
  expect(screen.getByText('Free')).toBeTruthy();
  await press(screen.getByText('Change plan'));
  const pro = await screen.findByText('Pro · $8 a month');
  await press(pro);
  await vi.waitFor(() => expect(screen.getByText('Pro')).toBeTruthy());
  await vi.waitFor(() => expect(screen.queryByText('Pro · $8 a month')).toBeNull());
  expect(screen.queryByText('Free')).toBeNull();
});

test('the accordion opens a question', async () => {
  await start();
  const answer = 'On servers in the European Union, encrypted at rest.';
  expect(screen.queryByText(answer)).toBeNull();
  await press(screen.getByText('Where is my data kept?'));
  await vi.waitFor(() => expect(screen.getByText(answer)).toBeTruthy());
});

test('the tabs switch what Help shows', async () => {
  await start();
  const invoices = 'Invoices are emailed on the first of each month.';
  const question = 'Where is my data kept?';
  expect(screen.queryByText(invoices)).toBeNull();
  await press(screen.getByText('Billing'));
  await vi.waitFor(() => expect(screen.getByText(invoices)).toBeTruthy());
  expect(screen.queryByText(question)).toBeNull();
  await press(screen.getByText('Account'));
  await vi.waitFor(() => expect(screen.getByText(question)).toBeTruthy());
  expect(screen.queryByText(invoices)).toBeNull();
});

test('Contact support opens a dialog, and Got it closes it', async () => {
  await start();
  const body = 'Write to support@example.com and we answer within a working day.';
  await press(screen.getByText('Contact support'));
  await vi.waitFor(() => expect(screen.getByText(body)).toBeTruthy());
  expect(screen.getAllByText('Contact support')).toHaveLength(2);
  await press(screen.getByText('Got it'));
  await vi.waitFor(() => expect(screen.queryByText(body)).toBeNull());
});

test('the app tears down without an error, with a dialog and an alert open', async () => {
  await start();
  await fillProfile('Ada', 'ada@example.com');
  await press(screen.getByTestId('profile-terms'));
  await press(saveButton());
  await press(screen.getByText('Contact support'));
  await vi.waitFor(() => expect(screen.getByText('Got it')).toBeTruthy());
  expect(() => cleanup()).not.toThrow();
});
