import { execFileSync } from 'node:child_process';
import { cleanup, render, screen, settle, userEvent } from '@ng-native/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { App } from './app.ts';
import { appConfig } from './app.config.ts';

let sheet: unknown;
beforeAll(async () => {
  // The global sheet with Material's theme, generated as Metro's config does.
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  sheet = (await import('../../.angular-native/app.tailwind.js')).default;
});
let snackBar: MatSnackBar | undefined;
afterEach(async () => {
  // An overlay still going away, a snack bar on its timer or a menu or a list of options
  // leaving, would finish after the app is gone.
  const opened = snackBar?._openedSnackBarRef;
  if (opened) {
    opened.dismiss();
    await new Promise((resolve) => opened.afterDismissed().subscribe(resolve));
  }
  await vi.waitFor(() => {
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
  });
  // A backdrop is taken away once its fade ends, or after 500ms where none is heard.
  await new Promise((resolve) => setTimeout(resolve, 600));
  cleanup();
});

async function start() {
  const { fixture } = await render(App, { globalStyles: sheet as never, ...appConfig });
  snackBar = fixture.componentRef.injector.get(MatSnackBar);
  // The screen is a lazy route, compiled on its first load here.
  await screen.findByText('Tasks', undefined, { timeout: 10_000 });
  await settle();
}

async function press(target: Parameters<typeof userEvent.press>[0]) {
  await userEvent.press(target);
  await settle();
}

test('checking a task off moves it to Done', async () => {
  await start();
  expect(screen.getByText('1 of 4 done')).toBeTruthy();
  await press(screen.getByText('Book flights'));
  await vi.waitFor(() => expect(screen.getByText('2 of 4 done')).toBeTruthy());
  expect(screen.queryByText('Book flights')).toBeNull();
  await press(screen.getByText('Done'));
  await vi.waitFor(() => expect(screen.getByText('Book flights')).toBeTruthy());
});

test('a task added in the dialog shows on the list', async () => {
  await start();
  await press(screen.getByLabelText('New task'));
  await vi.waitFor(() => expect(screen.getByTestId('task-title')).toBeTruthy());
  const user = userEvent.setup();
  await user.type(screen.getByTestId('task-title'), 'Pack bags');
  await settle();
  await press(screen.getByText('Add'));
  await vi.waitFor(() => expect(screen.getByText('Pack bags')).toBeTruthy());
  await vi.waitFor(() => expect(screen.getByText('Task added')).toBeTruthy());
});

test('a deleted task comes back with Undo', async () => {
  await start();
  await press(screen.getByLabelText('Delete Call the bank'));
  await vi.waitFor(() => expect(screen.queryByText('Call the bank')).toBeNull());
  await press(await screen.findByText('Undo'));
  await vi.waitFor(() => expect(screen.getByText('Call the bank')).toBeTruthy());
});

test('the menu clears what is done', async () => {
  await start();
  await press(screen.getByLabelText('More'));
  // A menu's items take no touch while it is coming in.
  const item = () => screen.getByRole('menuitem');
  await vi.waitFor(() => expect(item().props['pointerEvents']).not.toBe('none'));
  await press(item());
  await vi.waitFor(() => expect(screen.getByText('0 of 3 done')).toBeTruthy());
});

test('a task due tomorrow says so under its title', async () => {
  await start();
  await press(screen.getByLabelText('New task'));
  const user = userEvent.setup();
  await user.type(await screen.findByTestId('task-title'), 'Pack bags');
  await press(screen.getByTestId('task-due'));
  await press(await screen.findByText('Tomorrow'));
  await press(screen.getByText('Add'));
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = tomorrow.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  await vi.waitFor(() => expect(screen.getByText(day.replace(',', ''))).toBeTruthy());
  await vi.waitFor(() => expect(screen.getByText('Task added')).toBeTruthy());
});
