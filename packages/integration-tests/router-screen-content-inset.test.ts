/**
 * A stack page's content below an opaque header on iOS 26 and later.
 *
 * There react-native-screens lays every screen out under the navigation bar, opaque or not
 * (from 4.30, `+[RNSScreenStackHeaderConfig screensExtendUnderOpaqueNavigationBar]`), and insets
 * the content with the `SafeAreaView` its `ScreenStackItem` wraps it in: the top edge while the
 * header is shown and not translucent, none otherwise, and the view there either way so that a
 * change does not make the content again. A page whose content commits straight into the screen
 * starts behind the bar.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { OS_VERSION } from '@ng-native/device';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, screen, type FakeFabricNode } from '@ng-native/testing';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { registerScreenComponents } from '../router/src/screens.ts';
import { compileFixture } from './compile.ts';

type Header = { hidden?: boolean; translucent?: boolean; largeTitle?: boolean; absent?: boolean };

const NONE = { top: false, right: false, bottom: false, left: false };
const TOP = { ...NONE, top: true };

describe('a stack page under its header', () => {
  let mod: Record<string, unknown>;
  const header = () => mod['header'] as WritableSignal<Header>;
  const later = () => mod['later'] as WritableSignal<boolean>;

  before(async () => {
    registerScreenComponents();
    mod = await compileFixture('fixtures/screen-content-inset.ts');
  });

  afterEach(() => {
    cleanup();
    registerPlatformComponents('ios');
    registerScreenComponents();
    header().set({});
    later().set(false);
  });

  /** The page on a platform and OS version, with its header bound as given. */
  const open = async (platform: string, version: number, bound: Header = {}) => {
    registerPlatformComponents(platform);
    registerScreenComponents();
    header().set(bound);
    const app = await render(mod['OpeningHoursStack'] as Type<unknown>, {
      providers: [
        provideNativeRouter([{ path: '', component: mod['OpeningHours'] as Type<unknown> }]),
        { provide: OS_VERSION, useValue: version },
      ],
    });
    await app.detectChanges();
    return app;
  };

  /** The view the page's root content commits into. */
  const holder = (): FakeFabricNode => screen.getByText('Monday to Friday').parent!;

  it('commits the content in a safe area view that insets the top, on iOS 26', async () => {
    await open('ios', 26);
    const content = holder();
    assert.equal(content.viewName, 'RNSSafeAreaView');
    assert.equal(content.parent?.viewName, 'RNSScreen');
    assert.deepEqual(content.props['edges'], TOP);
  });

  it('fills the screen with it, as react-native-screens styles its own', async () => {
    await open('ios', 26);
    assert.equal(holder().props['flex'], 1);
  });

  it('keeps the header a child of the screen, after the content', async () => {
    await open('ios', 26);
    const children = holder().parent!.children.map((child) => child.viewName);
    assert.deepEqual(children, ['RNSSafeAreaView', 'RNSScreenStackHeaderConfig']);
  });

  it('puts content the page shows later in it too', async () => {
    const app = await open('ios', 26);
    later().set(true);
    await app.detectChanges();
    assert.equal(screen.getByText('Closed on holidays').parent, holder());
    assert.equal(holder().children.length, 3);
  });

  it('insets nothing under a hidden, translucent, large-title or absent header', async () => {
    for (const bound of [
      { hidden: true },
      { translucent: true },
      { largeTitle: true },
      { absent: true },
    ]) {
      await open('ios', 26, bound);
      assert.equal(holder().viewName, 'RNSSafeAreaView', JSON.stringify(bound));
      assert.deepEqual(holder().props['edges'], NONE, JSON.stringify(bound));
      cleanup();
    }
  });

  it('follows the header as it changes, without making the content again', async () => {
    const app = await open('ios', 26);
    const tag = screen.getByText('Monday to Friday').reactTag;
    header().set({ translucent: true });
    await app.detectChanges();
    assert.deepEqual(holder().props['edges'], NONE);
    header().set({});
    await app.detectChanges();
    assert.deepEqual(holder().props['edges'], TOP);
    assert.equal(screen.getByText('Monday to Friday').reactTag, tag);
  });

  it('leaves the top to it in a page that insets its own, so the bar is not counted twice', async () => {
    await open('ios', 26);
    const own = screen.getByTestId('own').props['edges'] as Record<string, boolean>;
    assert.deepEqual({ top: own['top'], bottom: own['bottom'] }, { top: false, bottom: true });
  });

  it('commits the content straight into the screen before iOS 26, as it did', async () => {
    await open('ios', 18);
    assert.equal(holder().viewName, 'RNSScreen');
    const own = screen.getByTestId('own').props['edges'] as Record<string, boolean>;
    assert.equal(own['top'], true);
  });

  it('commits the content straight into the screen on Android', async () => {
    await open('android', 36);
    assert.equal(holder().viewName, 'RNSScreen');
  });
});
