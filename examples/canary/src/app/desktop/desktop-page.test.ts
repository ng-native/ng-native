import { UndoStack } from '@ng-native/device';
import { provideNativeRouter } from '@ng-native/router';
import { fakeUndo, render, screen, settle, userEvent } from '@ng-native/testing';
import { expect, test, vi } from 'vitest';
import { appConfig } from '../app.config.ts';
import { DesktopPage } from './desktop-page.ts';

test('adds a star from the menu bar shortcut and takes it back with Edit > Undo', async () => {
  const undo = fakeUndo();
  await render(DesktopPage, {
    os: 'macos',
    providers: [provideNativeRouter([]), { provide: UndoStack.SOURCE, useValue: undo }],
  });
  expect(await userEvent.keyboard('mod+shift+s')).toBe(true);
  await userEvent.press(screen.getByTestId('star'));
  expect(screen.getByText('2 stars')).toBeTruthy();
  expect(undo.undoTitle).toBe('Undo Add a Star');
  undo.chooseUndo();
  await settle();
  expect(screen.getByText('1 stars')).toBeTruthy();
});

test('opens the library in a window of its own, with its sidebar', async () => {
  await render(DesktopPage, { os: 'macos', providers: [provideNativeRouter([])] });
  await userEvent.press(screen.getByTestId('library'));
  await settle();
  const library = screen.windows().find((window) => window.key === 'library');
  expect(library?.title).toBe('Library');
  expect(library?.getByText('Middlemarch')).toBeTruthy();
});

test("names the library's window in the app's providers, so it opens again after a reload", async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await render(DesktopPage, { os: 'macos', providers: appConfig.providers });
    await userEvent.press(screen.getByTestId('library'));
    await settle();
    expect(screen.windows().some((window) => window.key === 'library')).toBe(true);
    expect(warn.mock.calls.flat().join('\n')).not.toContain('will not open again');
  } finally {
    warn.mockRestore();
  }
});

test('lists what is dropped on it', async () => {
  await render(DesktopPage, { os: 'macos', providers: [provideNativeRouter([])] });
  await userEvent.dropFiles(screen.getByTestId('drop'), ['/Users/me/notes.md']);
  expect(screen.getByText('File notes.md')).toBeTruthy();
});

test.each([
  ['macos', 'On macOS. The menu bar has a Canary menu while this screen is open'],
  ['linux', 'On Linux. The Canary menu is a menu bar under the header bar on KDE Plasma'],
  ['ios', 'On iOS. On an iPad the menu bar has a Canary menu'],
  ['android', 'On Android. No menu bar is drawn'],
] as const)('names %s and says where its menu and shortcuts are', async (os, start) => {
  await render(DesktopPage, { os, providers: [provideNativeRouter([])] });
  expect(screen.getByText(new RegExp('^' + start))).toBeTruthy();
});

test('claims shortcuts only on the OSes that have them', async () => {
  await render(DesktopPage, { os: 'linux', providers: [provideNativeRouter([])] });
  expect(screen.getByText(/^On Linux\.(?!.*(iPad|iPhone|Android))/s)).toBeTruthy();
});

test('says there is one window on iOS', async () => {
  await render(DesktopPage, { providers: [provideNativeRouter([])] });
  await userEvent.press(screen.getByTestId('library'));
  await settle();
  expect(screen.getByText('This OS has one window.')).toBeTruthy();
});
