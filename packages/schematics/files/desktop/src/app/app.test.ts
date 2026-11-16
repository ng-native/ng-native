import { ErrorHandler } from '@angular/core';
import { Clipboard, type NativeClipboard } from '@ng-native/expo/clipboard';
import { render, screen, userEvent } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from './app.ts';

test('goes to a page from the menu bar and copies its title', async () => {
  const copied: string[] = [];
  const clipboard: NativeClipboard = {
    getStringAsync: async () => copied.at(-1) ?? '',
    setStringAsync: async (text) => (copied.push(text), true),
    addClipboardListener: () => ({ remove: () => {} }),
  };
  await render(App, { providers: [{ provide: Clipboard.SOURCE, useValue: clipboard }] });
  const user = userEvent.setup();

  expect(await userEvent.keyboard('mod+2')).toBe(true);
  expect(screen.getByRole('header', { name: 'Notes' })).toBeTruthy();

  await user.press(screen.getByRole('button', { name: 'Copy Title' }));
  expect(copied).toEqual(['Notes']);
});

test("hands a copy the clipboard refuses to Angular's ErrorHandler", async () => {
  const refused = new Error('no clipboard');
  const clipboard: NativeClipboard = {
    getStringAsync: async () => '',
    setStringAsync: async () => Promise.reject(refused),
    addClipboardListener: () => ({ remove: () => {} }),
  };
  const handled: unknown[] = [];
  await render(App, {
    providers: [
      { provide: Clipboard.SOURCE, useValue: clipboard },
      { provide: ErrorHandler, useValue: { handleError: (error: unknown) => handled.push(error) } },
    ],
  });

  await userEvent.setup().press(screen.getByRole('button', { name: 'Copy Title' }));
  expect(handled).toEqual([refused]);
  expect(screen.queryByText(/^Copied/)).toBeNull();
});
