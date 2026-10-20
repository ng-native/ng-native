/**
 * The window services, each with a window of its own.
 *
 * Every app on one native module shares that module's window, so a service keeps it by its source.
 * Services on different modules must not share one: not when their modules are absent, as in Node
 * and on the web host, and not when one object stands in for two modules.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { type Provider, type Type } from '@angular/core';
import { mount } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';
import {
  ColorScheme,
  NavigationBar,
  StatusBar,
  type ColorSchemeSource,
  type NavigationBarSource,
  type StatusBarSource,
} from '@ng-native/device';
import { Brightness } from '@ng-native/expo/brightness';
import { KeepAwake } from '@ng-native/expo/keep-awake';
import { DeviceOrientation } from '@ng-native/expo/orientation';
import { ScreenCapture } from '@ng-native/expo/screen-capture';
import { compileFixture } from './compile.ts';

let root: Type<unknown>;
before(async () => {
  root = (await compileFixture('fixtures/counter.ts'))['Counter'] as Type<unknown>;
});

let tags = 900;
/** A service in an app of its own, its native module the one the host has: none, in Node. */
function inApp<T>(service: Type<T>, providers: Provider[] = []) {
  const app = mount(tags++, root, createFakeFabric(), { providers });
  return {
    service: app.componentRef.injector.get(service),
    destroy: () => app.applicationRef.destroy(),
  };
}

/** Each service, and a use of it that goes through its window. */
const absent: [string, Type<unknown>, (service: never) => unknown][] = [
  ['Brightness', Brightness, (brightness: Brightness) => brightness.set(0.5)()],
  ['KeepAwake', KeepAwake, (keepAwake: KeepAwake) => keepAwake.hold()()],
  [
    'ScreenCapture',
    ScreenCapture,
    async (capture: ScreenCapture) => {
      await capture.prevent();
      await capture.allow();
    },
  ],
  [
    'DeviceOrientation',
    DeviceOrientation,
    (orientation: DeviceOrientation) => orientation.lock('portrait')(),
  ],
];

describe('window services whose native modules are absent', () => {
  for (const [firstName, first, useFirst] of absent) {
    for (const [secondName, second, useSecond] of absent) {
      if (first === second) continue;
      it(`gives ${secondName} its own window after ${firstName}`, async () => {
        const a = inApp(first);
        const b = inApp(second);
        try {
          await useFirst(a.service as never);
          await useSecond(b.service as never);
        } finally {
          a.destroy();
          b.destroy();
        }
      });
    }
  }
});

describe('one object standing in for the status bar and the navigation bar', () => {
  const colors: ColorSchemeSource = { current: () => 'light', subscribe: () => () => {} };

  it('gives each bar its own claims', () => {
    const calls: string[] = [];
    const source: StatusBarSource & NavigationBarSource = {
      setStyle: (style: string) => void calls.push(`style ${style}`),
      setHidden: (hidden: boolean) => void calls.push(`hidden ${hidden}`),
      setBackgroundColor: () => {},
      setTranslucent: () => {},
      height: undefined,
    };
    const scheme = [{ provide: ColorScheme.SOURCE, useValue: colors }];
    const status = inApp(StatusBar, [{ provide: StatusBar.SOURCE, useValue: source }, ...scheme]);
    const navigation = inApp(NavigationBar, [
      { provide: NavigationBar.SOURCE, useValue: source },
      ...scheme,
    ]);
    try {
      status.service.push({ hidden: true });
      assert.deepEqual(navigation.service.state(), {}, 'the navigation bar is claimed by nothing');
    } finally {
      status.destroy();
      navigation.destroy();
    }
  });
});
