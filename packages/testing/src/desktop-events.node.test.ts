/**
 * The desktop's user events and the recording fakes they reach: hover, double and right clicks,
 * the wheel, shortcuts through the menus host, and Tab, under any `os`.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Component, inject, signal } from '@angular/core';
import { Pressable, Shortcut, Text, TextInput, View } from '@ng-native/components';
import { Menus, Processes } from '@ng-native/device';
import { cleanup, fakeMenus, fakeProcesses, render, screen, userEvent } from '@ng-native/testing';

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
