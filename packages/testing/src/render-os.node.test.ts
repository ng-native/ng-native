/**
 * `render(X, { os })`: one render as another OS, so one file checks an OS gate both ways. It sets
 * the OS tokens, the view names and the `platform-<os>` class, a Mac's hover and pointer, and on a
 * desktop OS recording fakes of the desktop host's services, and puts the platform back after.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Component, inject, signal } from '@angular/core';
import { NativeButton, Text } from '@ng-native/components';
import { APPLE, DESKTOP, Dock, Menus, OS, OS_VERSION, Processes } from '@ng-native/device';
import { nativePlatform } from '@ng-native/fabric';
import {
  cleanup,
  fakeDock,
  provideDesktopFakes,
  render,
  screen,
  userEvent,
} from '@ng-native/testing';

afterEach(cleanup);

@Component({
  selector: 'app-gate',
  imports: [NativeButton, Text],
  template: `
    <text testID="os">{{ os }} {{ version }} {{ desktop }} {{ apple }}</text>
    <native-button testID="button">Save</native-button>
  `,
})
class Gate {
  protected readonly os = inject(OS);
  protected readonly version = inject(OS_VERSION);
  protected readonly desktop = inject(DESKTOP);
  protected readonly apple = inject(APPLE);
  readonly dock = inject(Dock);
  readonly menus = inject(Menus);
  readonly processes = inject(Processes);
}

test('renders as macOS: its tokens, its view names and recording fakes of its services', async () => {
  const { instance } = await render(Gate, { os: 'macos', osVersion: 26 });
  assert.ok(screen.getByText('macos 26 true true'));
  assert.equal(nativePlatform(), 'macos');
  assert.equal(screen.getByTestId('button').viewName, 'NgNativeButton');
  assert.equal(instance.dock.available(), true);
  assert.equal(instance.menus.available(), true);
  assert.equal(instance.processes.available(), true);
});

test("renders as the project's OS when the render names none, fakes included", async () => {
  // The Vitest preset's `os`, from `expo.platforms`: a desktop-only app tests as macOS.
  const before = process.env['NG_NATIVE_TEST_OS'];
  process.env['NG_NATIVE_TEST_OS'] = 'macos';
  try {
    const { instance } = await render(Gate);
    assert.ok(screen.getByText('macos  true true'));
    assert.equal(instance.menus.available(), true);
    assert.equal(instance.dock.available(), true);
  } finally {
    if (before === undefined) delete process.env['NG_NATIVE_TEST_OS'];
    else process.env['NG_NATIVE_TEST_OS'] = before;
  }
});

test('puts the platform back once the render goes', async () => {
  const before = nativePlatform();
  await render(Gate, { os: 'android' });
  assert.equal(screen.getByTestId('button').viewName, 'View');
  assert.ok(screen.getByText('android  false false'));
  cleanup();
  assert.equal(nativePlatform(), before);
});

test("names a view that takes its text as a prop by that text, as a native button's title", async () => {
  await render(Gate, { os: 'macos' });
  assert.equal(screen.getByRole('button', { name: 'Save' }), screen.getByTestId('button'));
  cleanup();
  await render(Gate, { os: 'ios' });
  assert.equal(screen.getByRole('button', { name: 'Save' }), screen.getByTestId('button'));
});

@Component({
  selector: 'app-counter',
  imports: [NativeButton],
  template: `
    <native-button (press)="count.set(count() + 1)">Add</native-button>
    <native-button disabled (press)="count.set(count() + 10)">Off</native-button>
  `,
})
class Counter {
  readonly count = signal(0);
}

test('presses a native button as the host does, with the press the button sends', async () => {
  for (const os of ['macos', 'ios'] as const) {
    const { instance } = await render(Counter, { os });
    await userEvent.press(screen.getByRole('button', { name: 'Add' }));
    await userEvent.press(screen.getByRole('button', { name: 'Off' }));
    assert.equal(instance.count(), 1, os);
    cleanup();
  }
});

test('leaves the desktop services absent on a phone OS', async () => {
  const { instance } = await render(Gate, { os: 'ios', osVersion: 18 });
  assert.ok(screen.getByText('ios 18 false true'));
  assert.equal(instance.dock.available(), false);
  assert.equal(instance.processes.available(), false);
});

@Component({
  selector: 'app-pointer',
  template: '<view testID="box" class="box" />',
  styles: `
    .box {
      opacity: 1;
    }
    @media (hover: hover) and (pointer: fine) {
      .box {
        opacity: 0.5;
      }
    }
  `,
})
class Pointer {}

test("answers a Mac's hover and fine pointer to media queries, and a phone's to neither", async () => {
  await render(Pointer, { os: 'macos' });
  assert.equal(screen.getByTestId('box').props['opacity'], 0.5);
  cleanup();
  await render(Pointer, { os: 'ios' });
  assert.equal(screen.getByTestId('box').props['opacity'], 1);
});

test('keeps a fake the test provides over the one the OS brings', async () => {
  const dock = fakeDock();
  const { instance } = await render(Gate, {
    os: 'macos',
    providers: [{ provide: Dock.SOURCE, useValue: dock }],
  });
  instance.dock.bounce({ critical: true });
  assert.deepEqual(dock.bounces, [{ critical: true, cancelled: false }]);
});

test('gives the fakes to a render on any OS through provideDesktopFakes', async () => {
  const { instance } = await render(Gate, { providers: provideDesktopFakes() });
  assert.equal(instance.dock.available(), true);
});
