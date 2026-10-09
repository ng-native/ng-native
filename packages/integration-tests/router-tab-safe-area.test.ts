/**
 * The safe area as a tab screen sees it: react-native-screens' own view, which asks the screen it
 * is in for its insets, and so knows how much of the bottom edge the tab bar covers.
 *
 * Native takes the edges as four booleans on every commit, so a partial record would leave the
 * edges it omits at whatever they were.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { registerScreenComponents } from '../router/src/screens.ts';
import { cleanup, render, screen, type RenderResult } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

describe('the tab safe area', () => {
  let mod: Record<string, unknown>;
  let app: RenderResult<{ edges: { set(value: readonly ('top' | 'bottom')[]): void } }>;

  before(async () => {
    registerScreenComponents();
    mod = await compileFixture('fixtures/tab-safe-area.ts');
  });

  beforeEach(async () => {
    app = await render(mod['TabSafeAreaHost'] as Type<typeof app.instance>);
  });

  afterEach(() => cleanup());

  it('commits the screens library view, not the safe-area-context one', () => {
    // RNCSafeAreaView reads the root provider, which sits above the tab bar and never hears of it.
    assert.equal(screen.getByTestId('all').viewName, 'RNSSafeAreaView');
  });

  it('insets every edge when the caller names none', () => {
    assert.deepEqual(screen.getByTestId('all').props['edges'], {
      top: true,
      right: true,
      bottom: true,
      left: true,
    });
  });

  it('turns a list of edges into all four, with the rest off', () => {
    assert.deepEqual(screen.getByTestId('some').props['edges'], {
      top: false,
      right: false,
      bottom: true,
      left: false,
    });
  });

  it('sends all four edges again when the caller changes one', async () => {
    app.instance.edges.set(['top']);
    await app.detectChanges();

    assert.deepEqual(screen.getByTestId('some').props['edges'], {
      top: true,
      right: false,
      bottom: false,
      left: false,
    });
  });

  it('takes its own padding from the stylesheet, which native adds the inset to as margin', () => {
    const content = screen.getByTestId('some');
    assert.equal(content.props['paddingBottom'], 16);
    assert.equal(content.props['marginBottom'], undefined, 'the margin is native to set');
  });
});

describe('the screen safe area', () => {
  let mod: Record<string, unknown>;
  let app: RenderResult<{ edges: { set(value: readonly ('top' | 'bottom')[]): void } }>;

  before(async () => {
    registerScreenComponents();
    mod = await compileFixture('fixtures/tab-safe-area.ts');
  });

  beforeEach(async () => {
    app = await render(mod['ScreenSafeAreaHost'] as Type<typeof app.instance>);
  });

  afterEach(() => cleanup());

  it('is the same native view, which asks whichever screen it is in', () => {
    assert.equal(screen.getByTestId('page').viewName, 'RNSSafeAreaView');
  });

  it('insets the edges it is given, as four booleans, and every edge when given none', () => {
    assert.deepEqual(screen.getByTestId('page').props['edges'], {
      top: true,
      right: false,
      bottom: false,
      left: false,
    });
    assert.deepEqual(screen.getByTestId('every').props['edges'], {
      top: true,
      right: true,
      bottom: true,
      left: true,
    });
  });

  it('sends all four edges again when the caller changes one', async () => {
    app.instance.edges.set(['bottom']);
    await app.detectChanges();

    assert.deepEqual(screen.getByTestId('page').props['edges'], {
      top: false,
      right: false,
      bottom: true,
      left: false,
    });
  });
});

describe('the screen safe area under a header', () => {
  let mod: Record<string, unknown>;

  before(async () => {
    registerScreenComponents();
    mod = await compileFixture('fixtures/tab-safe-area.ts');
  });

  afterEach(() => {
    cleanup();
    registerPlatformComponents('ios');
    (mod['header'] as WritableSignal<object>).set({});
  });

  /** The top and bottom edges the page commits, on a platform, with its header bound as given. */
  const edges = async (platform: string, header: object = {}) => {
    registerPlatformComponents(platform);
    registerScreenComponents();
    cleanup();
    (mod['header'] as WritableSignal<object>).set({});
    const app = await render(mod['PlannerStack'] as Type<unknown>, {
      providers: [provideNativeRouter([{ path: '', component: mod['Planner'] as Type<unknown> }])],
    });
    // The page first, with its bar as written, so a change is one from a bar that was there.
    await app.detectChanges();
    (mod['header'] as WritableSignal<object>).set(header);
    await app.detectChanges();
    const { top, bottom } = screen.getByTestId('planner').props['edges'] as Record<string, boolean>;
    return { top, bottom };
  };

  it('insets the top on iOS, where the screen says how much of it a bar covers', async () => {
    assert.deepEqual(await edges('ios'), { top: true, bottom: true });
  });

  it('leaves the top alone on Android under a bar, which the page already starts below', async () => {
    // Android's view insets by the status bar whatever is above it, and under an opaque bar that
    // is a gap the height of the status bar between the bar and the page.
    assert.deepEqual(await edges('android'), { top: false, bottom: true });
  });

  it('insets the top on Android when the bar is hidden, gone, or the page runs under it', async () => {
    assert.deepEqual(await edges('android', { hidden: true }), { top: true, bottom: true });
    assert.deepEqual(await edges('android', { translucent: true }), { top: true, bottom: true });
    assert.deepEqual(await edges('android', { absent: true }), { top: true, bottom: true });
  });
});
