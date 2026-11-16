/**
 * A macOS app's windows, menus and lifecycle in a test: the windows' fake every macOS render gets,
 * `screen.windows()`, the menu fakes queried by role, a right-click's context menu, a file drop,
 * and the lifecycle verbs (`closeWindow`, `quit`, `reopen`, `openUrl`). The host contract for a
 * drop is in `drag-and-drop.test.ts` in `@ng-native/integration-tests`.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Component, inject, input, signal } from '@angular/core';
import {
  ContextMenu,
  FileDrop,
  MenuBar,
  MenuGroup,
  MenuItem,
  Text,
  TextInput,
  View,
  type DroppedFile,
} from '@ng-native/components';
import {
  AppLifecycle,
  AppWindows,
  CURRENT_WINDOW,
  DeepLinks,
  provideMainWindow,
} from '@ng-native/device';
import {
  cleanup,
  fakeMenus,
  fakeWindows,
  render,
  screen,
  settle,
  userEvent,
  type FakeWindows,
} from '@ng-native/testing';
import { Menus } from '@ng-native/device';

afterEach(cleanup);

@Component({
  selector: 'app-note',
  imports: [Text],
  template: '<text>Draft {{ name }}</text>',
})
class Note {
  name = '';
  readonly unsaved = signal(false);

  constructor() {
    inject(CURRENT_WINDOW)?.canClose(() => !this.unsaved());
    Note.made.push(this);
  }

  static readonly made: Note[] = [];
}

@Component({
  selector: 'app-notes',
  imports: [Text, View, ContextMenu, FileDrop, MenuItem, MenuBar, MenuGroup],
  template: `
    <menu-bar>
      <menu-group label="File" menuRole="file">
        <menu-item label="New Note" shortcut="mod+n" (select)="log('new')" />
        <menu-item label="About Notes" menuRole="about" (select)="log('about')" />
      </menu-group>
    </menu-bar>
    <view
      testID="list"
      [contextMenu]="rowMenu"
      (fileDragEnter)="log('enter')"
      (fileDrop)="dropped($event.files)"
    >
      <text>Notes</text>
    </view>
    <ng-template #rowMenu>
      <menu-item label="Rename" (select)="log('rename')" />
      <menu-item label="Delete" destructive (select)="log('delete')" />
    </ng-template>
  `,
})
class Notes {
  readonly windows = inject(AppWindows);
  readonly lifecycle = inject(AppLifecycle);
  readonly links = signal<string[]>([]);
  readonly heard = signal<string[]>([]);

  constructor() {
    inject(DeepLinks).subscribe((path) => this.links.update((all) => [...all, path]));
  }

  log(line: string): void {
    this.heard.update((lines) => [...lines, line]);
  }

  dropped(files: readonly DroppedFile[]): void {
    this.log(`drop ${files.map((file) => `${file.name} ${file.uri}`).join(', ')}`);
  }
}

test('renders a macOS app in its main window, and lists every window it opens', async () => {
  const { instance } = await render(Notes, { os: 'macos' });
  const [main] = screen.windows();
  assert.equal(main?.key, 'main');
  assert.ok(main.getByText('Notes'));
  await instance.windows.open(Note, { title: 'Groceries', restoreKey: 'groceries' });
  await settle();
  const windows = screen.windows();
  assert.deepEqual(
    windows.map((window) => [window.key, window.title]),
    [
      ['main', ''],
      ['groceries', 'Groceries'],
    ],
  );
  assert.ok(windows[1]!.getByText(/^Draft/));
  assert.equal(windows[1]!.queryByText('Notes'), null, 'each window has its own views');
  assert.ok(screen.getByText(/^Draft/), 'screen queries every window');
});

test('closes a window through its guards, quits, and opens the main window on a Dock click', async () => {
  const { instance } = await render(Notes, { os: 'macos' });
  await instance.windows.open(Note, { title: 'Draft' });
  await settle();
  Note.made.at(-1)!.unsaved.set(true);
  const draft = screen.windows()[1]!;
  assert.equal(await userEvent.closeWindow(draft), false, 'the guard kept it');
  assert.equal(screen.windows().length, 2);
  assert.equal(await userEvent.quit(), false, 'the guard kept the app');
  Note.made.at(-1)!.unsaved.set(false);
  assert.equal(await userEvent.closeWindow(draft), true);
  assert.equal(await userEvent.closeWindow(), true, 'the focused window, or the main one');
  assert.deepEqual(screen.windows(), []);
  await userEvent.reopen();
  assert.equal(screen.windows()[0]?.key, 'main');
  assert.equal(await userEvent.quit(), true);
});

test('waits for a slow guard and a slow willQuit handler, not a number of turns', async () => {
  const { instance } = await render(Notes, { os: 'macos' });
  const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  await instance.windows.open(Note, { title: 'Draft' });
  await settle();
  const draft = screen.windows()[1]!;
  instance.windows.windows()[1]!.canClose(async () => {
    await later(150);
    return true;
  });
  assert.equal(await userEvent.closeWindow(draft), true, 'the guard agreed, late');
  instance.lifecycle.willQuit(async () => void (await later(150)));
  assert.equal(await userEvent.quit(), true, 'the handler finished, late');
});

@Component({
  selector: 'app-field',
  imports: [TextInput],
  template: '<text-input [testID]="name()" (focus)="focused.push(name())" />',
})
class Field {
  readonly name = input('main');
  readonly windows = inject(AppWindows);
  static readonly focused: string[] = [];
  protected readonly focused = Field.focused;
}

test('walks Tab through the focused window only', async () => {
  const { instance } = await render(Field, { os: 'macos' });
  await instance.windows.open(Field, { title: 'Second', inputs: { name: 'second' } });
  await settle();
  instance.windows.windows()[1]!.focus();
  await settle();
  Field.focused.length = 0;
  await userEvent.tab();
  await userEvent.tab();
  assert.deepEqual(Field.focused, ['second', 'second'], 'never into the main window');
});

test('drops a window the host reports closed from the windows it lists', async () => {
  const { instance, componentRef } = await render(Notes, { os: 'macos' });
  await instance.windows.open(Note, { title: 'Draft' });
  await settle();
  const host = componentRef.injector.get(AppWindows.SOURCE) as FakeWindows;
  const draft = screen.windows()[1]!;
  // As the OS closes it on its own, without asking the app.
  host.emit({ type: 'closed', surface: draft.surface });
  await settle();
  assert.deepEqual(screen.windows().length, 1);
});

test('starts with no window under autoOpen: false', async () => {
  await render(Notes, { os: 'macos', providers: [provideMainWindow({ autoOpen: false })] });
  assert.deepEqual(screen.windows(), []);
  await userEvent.reopen();
  assert.equal(screen.windows().length, 1);
});

test('waits for the window a Dock click opens, however late the host opens it', async () => {
  const host = fakeWindows();
  const open = host.open;
  host.open = async (request) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return open(request);
  };
  await render(Notes, {
    os: 'macos',
    providers: [
      provideMainWindow({ autoOpen: false }),
      { provide: AppWindows.SOURCE, useValue: host },
    ],
  });
  await userEvent.reopen();
  assert.equal(screen.windows().length, 1, 'open once reopen resolves');
});

test('delivers a url the OS opens the app with', async () => {
  const { instance } = await render(Notes, { os: 'macos' });
  await userEvent.openUrl('notes://note/42');
  assert.deepEqual(instance.links(), ['/note/42']);
});

test('finds menu items by role and by label, and chooses them', async () => {
  const menus = fakeMenus();
  const { instance } = await render(Notes, {
    os: 'macos',
    providers: [{ provide: Menus.SOURCE, useValue: menus }],
  });
  assert.equal(menus.item({ menuRole: 'about' })?.label, 'About Notes');
  assert.equal(menus.item({ menuRole: 'close' })?.label, 'Close Window');
  assert.equal(menus.item({ label: 'New Note' })?.label, 'New Note');
  assert.equal(menus.item({ label: 'Nothing' }), null);
  menus.choose({ menuRole: 'about' });
  menus.choose({ label: /^New/ });
  assert.deepEqual(instance.heard(), ['about', 'new']);
  assert.throws(() => menus.choose({ label: 'Nothing' }), /No menu item/);
});

test("opens a view's context menu on a right-click, and chooses from it", async () => {
  const { instance } = await render(Notes, { os: 'macos' });
  const menu = await userEvent.rightClick(screen.getByTestId('list'));
  assert.ok(menu);
  assert.deepEqual(
    menu.items.map((item) => item.label),
    ['Rename', 'Delete'],
  );
  await menu.choose('Delete');
  assert.deepEqual(instance.heard(), ['delete']);
  const inside = await userEvent.rightClick(screen.getByText('Notes'));
  assert.equal(inside?.items[0]?.label, 'Rename', 'the menu of the view it is in');
});

test('drops files on a view', async () => {
  const { instance } = await render(Notes, { os: 'macos' });
  await userEvent.dropFiles(screen.getByTestId('list'), ['/Users/me/a.md']);
  assert.deepEqual(instance.heard(), ['enter', 'drop a.md file:///Users/me/a.md']);
});
