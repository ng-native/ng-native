/**
 * The desktop's user events and the recording fakes they reach: hover, double and right clicks,
 * the wheel, shortcuts through the menus host, and Tab, under any `os`.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Component, inject, signal } from '@angular/core';
import {
  MenuBar,
  MenuGroup,
  MenuItem,
  Pressable,
  Shortcut,
  Text,
  TextInput,
  View,
} from '@ng-native/components';
import { AppWindows, Menus, Processes } from '@ng-native/device';
import {
  cleanup,
  fakeMenus,
  fakeProcesses,
  fireEvent,
  render,
  screen,
  settle,
  userEvent,
} from '@ng-native/testing';

afterEach(cleanup);

@Component({
  selector: 'app-mouse',
  imports: [Pressable, Text, View],
  template: `
    <view testID="outer" (mouseenter)="log('enter outer')" (mouseleave)="log('leave outer')">
      <pressable
        #p="pressable"
        testID="inner"
        (mouseenter)="log('enter inner')"
        (mouseleave)="log('leave inner')"
        (dblclick)="log('double')"
        (contextmenu)="log('menu')"
        (wheel)="log('wheel ' + $any($event).nativeEvent.deltaY)"
      >
        <text>{{ p.hovered() ? 'hovered' : 'still' }}</text>
      </pressable>
    </view>
  `,
})
class Mouse {
  readonly heard = signal<string[]>([]);
  log(line: string): void {
    this.heard.update((lines) => [...lines, line]);
  }
}

test('hovers into each view the pointer comes over, and out of each again', async () => {
  const { instance } = await render(Mouse, { os: 'macos' });
  await userEvent.hover(screen.getByTestId('inner'));
  assert.ok(screen.getByText('hovered'));
  await userEvent.unhover(screen.getByTestId('inner'));
  assert.ok(screen.getByText('still'));
  assert.deepEqual(instance.heard(), ['enter outer', 'enter inner', 'leave inner', 'leave outer']);
});

test('double-clicks, right-clicks and scrolls', async () => {
  const { instance } = await render(Mouse, { os: 'macos' });
  await userEvent.dblClick(screen.getByTestId('inner'));
  await userEvent.rightClick(screen.getByTestId('inner'));
  await userEvent.wheel(screen.getByTestId('inner'), { deltaY: 40 });
  assert.deepEqual(instance.heard(), ['double', 'menu', 'wheel 40']);
});

@Component({
  selector: 'app-keys',
  imports: [Pressable, Shortcut, Text, TextInput],
  template: `
    <pressable testID="find" class="find" shortcut="mod+k" (shortcutPress)="log('find')"
      ><text>Find</text></pressable
    >
    <pressable testID="undo" shortcut="mod+z" (shortcutPress)="log('undo')"
      ><text>Undo</text></pressable
    >
    <text-input testID="field" />
  `,
  styles: `
    .find:focus-visible {
      opacity: 0.5;
    }
  `,
})
class Keys {
  readonly heard = signal<string[]>([]);
  readonly menus = inject(Menus);
  log(line: string): void {
    this.heard.update((lines) => [...lines, line]);
  }
}

test('presses a shortcut, with mod as Cmd on macOS and Ctrl on Android', async () => {
  const menus = fakeMenus();
  const { instance } = await render(Keys, {
    os: 'macos',
    providers: [{ provide: Menus.SOURCE, useValue: menus }],
  });
  assert.equal(await userEvent.keyboard('mod+k'), true);
  assert.equal(await userEvent.keyboard('mod+j'), false);
  assert.deepEqual(instance.heard(), ['find']);
  assert.deepEqual(menus.shortcuts.find((s) => s.chord.key === 'k')?.chord.meta, true);
  cleanup();

  const android = fakeMenus();
  const second = await render(Keys, {
    os: 'android',
    providers: [{ provide: Menus.SOURCE, useValue: android }],
  });
  assert.equal(await userEvent.keyboard('ctrl+k'), true);
  assert.deepEqual(second.instance.heard(), ['find']);
});

@Component({
  selector: 'app-menu-keys',
  imports: [MenuBar, MenuGroup, MenuItem],
  template: `
    <menu-bar>
      <menu-group label="File">
        <menu-item label="New" shortcut="mod+n" (select)="log('new')" />
        <menu-item label="Archive" shortcut="mod+e" disabled (select)="log('archive')" />
        <menu-group label="Open Recent">
          <menu-item label="Notes" shortcut="mod+shift+1" (select)="log('notes')" />
        </menu-group>
      </menu-group>
    </menu-bar>
  `,
})
class MenuKeys {
  readonly heard = signal<string[]>([]);
  log(line: string): void {
    this.heard.update((lines) => [...lines, line]);
  }
}

test("presses a menu item's key equivalent where the menu bar is drawn, as AppKit does", async () => {
  const menus = fakeMenus();
  const { instance } = await render(MenuKeys, {
    os: 'macos',
    providers: [{ provide: Menus.SOURCE, useValue: menus }],
  });
  assert.equal(await userEvent.keyboard('mod+n'), true);
  assert.equal(await userEvent.keyboard('mod+shift+1'), true, 'in a submenu too');
  assert.equal(await userEvent.keyboard('mod+e'), false, 'not a disabled item');
  assert.equal(await userEvent.keyboard('mod+j'), false);
  assert.deepEqual(instance.heard(), ['new', 'notes']);
});

@Component({
  selector: 'app-navigation-menu-keys',
  imports: [MenuBar, MenuGroup, MenuItem],
  template: `
    <menu-bar>
      <menu-group label="Go" menuRole="view">
        @if (shown()) {
          <menu-item
            label="Custom Back"
            [shortcut]="backShortcut()"
            [disabled]="disabled()"
            (select)="heard.set('back')"
          />
          <menu-group label="History">
            <menu-item label="Custom Forward" shortcut="cmd+]" (select)="heard.set('forward')" />
          </menu-group>
        }
        @if (replaceBack()) {
          <menu-item
            menuRole="back"
            label="Role Back"
            shortcut="mod+["
            (select)="heard.set('role')"
          />
        }
        @if (systemRole()) {
          <menu-item menuRole="find" label="System Find" shortcut="mod+[" />
        }
        <menu-item label="Other Back" shortcut="mod+shift+[" (select)="heard.set('other')" />
        <menu-item label="Sidebar Shortcut" shortcut="ctrl+mod+s" (select)="heard.set('sidebar')" />
      </menu-group>
    </menu-bar>
  `,
})
class NavigationMenuKeys {
  readonly shown = signal(true);
  readonly disabled = signal(false);
  readonly backShortcut = signal('mod+[');
  readonly replaceBack = signal(false);
  readonly systemRole = signal(false);
  readonly heard = signal('');
}

test("an enabled menu item's shortcut takes Cmd-[ and Cmd-] from AppKit's defaults", async () => {
  const menus = fakeMenus();
  const { instance } = await render(NavigationMenuKeys, {
    os: 'macos',
    providers: [{ provide: Menus.SOURCE, useValue: menus }],
  });
  const backKey = () => menus.item({ menuRole: 'back' })?.shortcut?.key;
  assert.equal(await userEvent.keyboard('mod+['), true);
  assert.equal(instance.heard(), 'back');
  assert.equal(await userEvent.keyboard('mod+]'), true);
  assert.equal(instance.heard(), 'forward');
  assert.ok(menus.item({ menuRole: 'back' }), 'the built-in Back command stays in the menu');
  assert.equal(menus.item({ menuRole: 'toggleSidebar' })?.shortcut?.key, 's');

  instance.disabled.set(true);
  await settle();
  assert.equal(backKey(), '[');
  assert.equal(await userEvent.keyboard('mod+['), true);
  assert.equal(instance.heard(), 'forward');

  instance.disabled.set(false);
  instance.backShortcut.set('ctrl+[');
  await settle();
  assert.equal(backKey(), '[');
  assert.equal(await userEvent.keyboard('ctrl+['), true);
  assert.equal(instance.heard(), 'back');

  instance.shown.set(false);
  await settle();
  assert.equal(menus.item({ menuRole: 'forward' })?.shortcut?.key, ']');
  assert.equal(await userEvent.keyboard('mod+shift+['), true);
  assert.equal(instance.heard(), 'other');
  assert.equal(backKey(), '[');

  instance.systemRole.set(true);
  await settle();
  assert.equal(backKey(), '[');
  instance.systemRole.set(false);
  instance.replaceBack.set(true);
  await settle();
  assert.equal(await userEvent.keyboard('mod+['), true);
  assert.equal(instance.heard(), 'role');
});

test('keeps the standard navigation key equivalents on iPadOS', async () => {
  const menus = fakeMenus();
  await render(NavigationMenuKeys, {
    os: 'ios',
    providers: [{ provide: Menus.SOURCE, useValue: menus }],
  });
  assert.equal(menus.item({ menuRole: 'back' })?.shortcut?.key, '[');
  assert.equal(menus.item({ menuRole: 'forward' })?.shortcut?.key, ']');
});

test('walks focus with Tab, as focus from the keyboard, and leaves the editing keys to a field', async () => {
  const { instance } = await render(Keys, { os: 'macos' });
  await userEvent.tab();
  assert.equal(screen.getByTestId('find').props['opacity'], 0.5, 'focus from the keyboard');
  await userEvent.tab();
  await userEvent.tab();
  assert.notEqual(screen.getByTestId('find').props['opacity'], 0.5);
  await userEvent.keyboard('mod+z');
  assert.deepEqual(instance.heard(), [], 'a focused text input keeps undo');
  await userEvent.tab({ shift: true });
  await userEvent.keyboard('mod+z');
  assert.deepEqual(instance.heard(), ['undo']);
});

test('walks focus on from where typing and blur left it', async () => {
  const { instance } = await render(Keys, { os: 'macos' });
  const field = screen.getByTestId('field');
  await userEvent.type(field, 'a', { skipBlur: true });
  await userEvent.keyboard('mod+z');
  assert.deepEqual(instance.heard(), [], 'the field typed in keeps undo');
  await userEvent.tab({ shift: true });
  await userEvent.keyboard('mod+z');
  assert.deepEqual(instance.heard(), ['undo'], 'Tab went back from the field');
  await userEvent.type(field, 'b');
  await userEvent.keyboard('mod+z');
  assert.deepEqual(instance.heard(), ['undo', 'undo'], 'typing ended with a blur');
  await fireEvent.focus(field);
  await fireEvent.blur(field);
  await userEvent.keyboard('mod+z');
  assert.deepEqual(instance.heard(), ['undo', 'undo', 'undo'], 'a blur leaves no field focused');
});

@Component({
  selector: 'app-lone-field',
  imports: [TextInput],
  template: '<text-input testID="lone" />',
})
class LoneField {}

@Component({
  selector: 'app-going-field',
  imports: [Pressable, Shortcut, Text, TextInput],
  template: `
    <pressable testID="undo" shortcut="mod+z" (shortcutPress)="undos.set(undos() + 1)"
      ><text>Undo</text></pressable
    >
    @if (shown()) {
      <text-input testID="field" />
    }
  `,
})
class GoingField {
  readonly shown = signal(true);
  readonly undos = signal(0);
  readonly windows = inject(AppWindows);
}

test('forgets the focused field once it is removed or its window closes, without a blur', async () => {
  const { instance } = await render(GoingField, { os: 'macos' });
  await fireEvent.focus(screen.getByTestId('field'));
  instance.shown.set(false);
  await settle();
  await userEvent.keyboard('mod+z');
  assert.equal(instance.undos(), 1, 'a removed field no longer keeps undo');

  await instance.windows.open(LoneField, { title: 'Second' });
  await settle();
  await fireEvent.focus(screen.getByTestId('lone'));
  assert.equal(await userEvent.closeWindow(screen.windows()[1]), true);
  await userEvent.keyboard('mod+z');
  assert.equal(instance.undos(), 2, 'nor does a field in a closed window');
});

@Component({ selector: 'app-git', template: '' })
class Git {
  readonly processes = inject(Processes);
}

test('records what a spawned program was given, and plays its output', async () => {
  const processes = fakeProcesses({
    env: { HOME: '/Users/me' },
    spawn: [{ program: 'git', args: ['status'] }],
    programs: { '/usr/bin/git': { stdout: 'clean', code: 0 } },
  });
  const { instance } = await render(Git, {
    os: 'macos',
    providers: [{ provide: Processes.SOURCE, useValue: processes }],
  });
  const git = await instance.processes.spawn('git', ['status']);
  const out: string[] = [];
  git?.onStdout((chunk) => out.push(chunk));
  assert.deepEqual(await git?.exit, { code: 0, signal: null });
  assert.deepEqual(out, ['clean']);
  assert.equal(processes.spawned[0]?.program, '/usr/bin/git');
});
