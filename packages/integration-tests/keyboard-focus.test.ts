/**
 * An iPad's hardware keyboard focus (#1900). React Native's iOS props have no `focusable`, so a view
 * that commits `focusable: true` also tells `@ng-native/components`' pod, by react tag, once it is
 * committed (`KEYBOARD_FOCUS`, `reportKeyboardFocusable`). The pod forgets a view React Native
 * recycles, so nothing is reported as a view goes.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { KEYBOARD_FOCUS, reportKeyboardFocusable } from '@ng-native/device';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render } from '@ng-native/testing';
import { compileSource } from './compile.ts';

type Fixture = { focusable: { set(value: boolean): void } };
let Focus: Type<Fixture>;

before(async () => {
  const file = path.join(import.meta.dirname, 'keyboard-focus.fixture.ts');
  const mod = await compileSource(
    `
import { Component, signal } from '@angular/core';
import { Pressable } from '../components/src/pressable.ts';
import { View } from '../components/src/view.ts';
@Component({
  selector: 'x-focus',
  imports: [Pressable, View],
  template: \`
    <pressable testID="pressable" />
    <pressable testID="disabled" [disabled]="true" />
    <pressable testID="refused" [focusable]="false" />
    <view testID="plain" />
    <view testID="own" [focusable]="focusable()" />
    <view testID="bare"><pressable /></view>
  \`,
})
export class Focus {
  readonly focusable = signal(true);
}
`,
    file,
    file.replace(/\.ts$/, '.generated.ts'),
  );
  Focus = mod['Focus'] as Type<Fixture>;
});

afterEach(cleanup);

/** Renders the fixture, hearing what its views report. */
async function heard() {
  const reports: [number, boolean][] = [];
  const rendered = await render(Focus, {
    providers: [
      {
        provide: KEYBOARD_FOCUS,
        useValue: (tag: number, f: boolean) => void reports.push([tag, f]),
      },
    ],
  });
  const tag = (id: string) => rendered.getByTestId(id).reactTag;
  /** The react tag of the first child of the view with `id`. */
  const child = (id: string) => rendered.getByTestId(id).children[0]!.reactTag;
  return { ...rendered, reports, tag, child };
}

describe('on iOS', () => {
  it('reports each view that commits focusable: true, by react tag, and no other', async () => {
    const { reports, tag, child } = await heard();
    assert.deepEqual(
      [...reports].sort((a, b) => a[0] - b[0]),
      [
        [tag('pressable'), true],
        // Native refuses a disabled view its focus; the view is still focusable, as React Native's.
        [tag('disabled'), true],
        [tag('own'), true],
        // A pressable with nothing bound, which only ngOnInit's default makes focusable.
        [child('bare'), true],
      ].sort((a, b) => (a[0] as number) - (b[0] as number)),
    );
  });

  it('reports a view that stops and starts being focusable', async () => {
    const { reports, tag, instance, rerender } = await heard();
    reports.length = 0;
    instance.focusable.set(false);
    await rerender();
    instance.focusable.set(true);
    await rerender();
    assert.deepEqual(reports, [
      [tag('own'), false],
      [tag('own'), true],
    ]);
  });
});

describe('off iOS', () => {
  for (const os of ['android', 'macos'] as const) {
    it(`reports nothing on ${os}, which takes the focusable prop itself`, async () => {
      registerPlatformComponents(os);
      try {
        const { reports } = await heard();
        assert.deepEqual(reports, []);
      } finally {
        registerPlatformComponents('ios');
      }
    });
  }
});

describe("the keyboard focus module's platform source", () => {
  /** A device for one call: React Native on `os`, with the pod's module linked. */
  function onDevice(os: string, run: () => void): [number, boolean][] {
    const calls: [number, boolean][] = [];
    const host = globalThis as Record<string, unknown>;
    const module = { setFocusable: (tag: number, f: boolean) => void calls.push([tag, f]) };
    host['require'] = (id: string) =>
      id === 'react-native'
        ? {
            Platform: { OS: os },
            TurboModuleRegistry: {
              get: (name: string) => (name === 'NgNativeKeyboardFocus' ? module : null),
            },
          }
        : undefined;
    host['nativeFabricUIManager'] = {};
    try {
      run();
    } finally {
      delete host['require'];
      delete host['nativeFabricUIManager'];
    }
    return calls;
  }

  it("tells the pod's module on iOS", () => {
    assert.deepEqual(
      onDevice('ios', () => reportKeyboardFocusable(7, true)),
      [[7, true]],
    );
  });

  it('asks for no module elsewhere', () => {
    registerPlatformComponents('android');
    try {
      assert.deepEqual(
        onDevice('android', () => reportKeyboardFocusable(7, true)),
        [],
      );
    } finally {
      registerPlatformComponents('ios');
    }
  });
});

after(() => registerPlatformComponents('ios'));
