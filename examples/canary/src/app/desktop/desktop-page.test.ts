import { UndoStack } from '@ng-native/device';
import { provideNativeRouter } from '@ng-native/router';
import { fakeUndo, render, screen, settle, userEvent } from '@ng-native/testing';
import { expect, test } from 'vitest';
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

test('lists what is dropped on it', async () => {
  await render(DesktopPage, { os: 'macos', providers: [provideNativeRouter([])] });
  await userEvent.dropFiles(screen.getByTestId('drop'), ['/Users/me/notes.md']);
  expect(screen.getByText('File notes.md')).toBeTruthy();
});

test('says there is one window on iOS', async () => {
  await render(DesktopPage, { providers: [provideNativeRouter([])] });
  await userEvent.press(screen.getByTestId('library'));
  await settle();
  expect(screen.getByText('This OS has one window.')).toBeTruthy();
});
