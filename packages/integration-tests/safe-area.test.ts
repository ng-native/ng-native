/**
 * The safe area: a view that insets itself natively, and a provider that reports the numbers.
 *
 * The edge record is the part worth pinning. Native takes all four edges on every commit, so a
 * partial one leaves the edges it omits at whatever they were - an inset that will not go away,
 * and one that only appears once something else changes an edge.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { SafeArea, Screen } from '@ng-native/device';
import { cleanup, fireEvent, render, screen, type RenderResult } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

describe('the safe area', () => {
  let mod: Record<string, unknown>;
  let app: RenderResult<{ edges: { set(value: readonly ('top' | 'bottom')[]): void } }>;

  before(async () => {
    mod = await compileFixture('fixtures/safe-area.ts');
  });

  beforeEach(async () => {
    app = await render(mod['SafeAreaHost'] as Type<typeof app.instance>);
  });

  afterEach(() => cleanup());

  it('commits the context components rather than the deprecated core one', () => {
    assert.equal(screen.getByTestId('provider').viewName, 'RNCSafeAreaProvider');
    assert.equal(screen.getByTestId('all').viewName, 'RNCSafeAreaView');
  });

  it('insets every edge when the caller names none', () => {
    assert.deepEqual(screen.getByTestId('all').props['edges'], {
      top: 'additive',
      right: 'additive',
      bottom: 'additive',
      left: 'additive',
    });
  });

  it('turns a list of edges into all four, with the rest off', () => {
    assert.deepEqual(screen.getByTestId('some').props['edges'], {
      top: 'off',
      right: 'off',
      bottom: 'additive',
      left: 'off',
    });
    assert.equal(screen.getByTestId('some').props['mode'], 'margin');
  });

  it('keeps a per-edge mode, which is what maximum is for', () => {
    assert.deepEqual(screen.getByTestId('record').props['edges'], {
      top: 'maximum',
      right: 'off',
      bottom: 'off',
      left: 'off',
    });
  });

  it('sends all four edges again when the caller changes one', async () => {
    app.instance.edges.set(['top']);
    await app.detectChanges();

    assert.deepEqual(screen.getByTestId('some').props['edges'], {
      top: 'additive',
      right: 'off',
      bottom: 'off',
      left: 'off',
    });
  });

  it('reports what native measured, and says so only once it has', async () => {
    const area = app.componentRef.injector.get(SafeArea);
    assert.equal(area.known(), false, 'nothing is known before a view has been laid out');
    assert.deepEqual(area.insets(), { top: 0, right: 0, bottom: 0, left: 0 });

    await fireEvent(screen.getByTestId('provider'), 'insetsChange', {
      insets: { top: 59, right: 0, bottom: 34, left: 0 },
      frame: { x: 0, y: 0, width: 402, height: 874 },
    });

    assert.equal(area.insets().top, 59);
    assert.equal(area.insets().bottom, 34, 'the home indicator');
    assert.equal(area.frame()?.height, 874);
    assert.equal(area.known(), true);
  });

  it('publishes the insets as custom properties, so a stylesheet can use them', async () => {
    // The numbers are a property of the device and the rotation, so no stylesheet can hold them,
    // and yet a padding that clears the home indicator is a padding. Seeding them on the root is
    // what `env()` is on the web.
    await fireEvent(screen.getByTestId('provider'), 'insetsChange', {
      insets: { top: 59, right: 0, bottom: 34, left: 0 },
      frame: { x: 0, y: 0, width: 402, height: 874 },
    });

    // The floating button in the fixture clears the home indicator through the stylesheet alone.
    assert.equal(screen.getByTestId('floating').props['marginBottom'], 34);
    assert.equal(screen.getByTestId('floating').props['paddingTop'], 59);
  });

  it('leaves the app safe area alone for a provider that only serves its own subtree', async () => {
    const area = app.componentRef.injector.get(SafeArea);
    await fireEvent(screen.getByTestId('provider'), 'insetsChange', {
      insets: { top: 59, right: 0, bottom: 34, left: 0 },
      frame: { x: 0, y: 0, width: 402, height: 874 },
    });
    // A sheet covering half the screen measures its own geometry, which is not the app's.
    await fireEvent(screen.getByTestId('nested'), 'insetsChange', {
      insets: { top: 0, right: 0, bottom: 34, left: 0 },
      frame: { x: 0, y: 437, width: 402, height: 437 },
    });

    assert.equal(area.insets().top, 59, 'still the window the app is laid out in');
    assert.equal(area.frame()?.height, 874);
  });
});

describe('a safe-area provider going away', () => {
  type Size = { width: number; height: number };
  type Host = {
    first: { set(value: boolean): void };
    second: { set(value: boolean): void };
  };
  let mod: Record<string, unknown>;
  let app: RenderResult<Host>;
  let rotate: (window: Size) => void;

  const PORTRAIT = { x: 0, y: 0, width: 402, height: 874 };
  const NOTCH = { top: 59, right: 0, bottom: 34, left: 0 };

  before(async () => {
    mod = await compileFixture('fixtures/safe-area.ts');
  });

  beforeEach(async () => {
    let window: Size = { width: 402, height: 874 };
    let listener: (sizes: { window: Size; screen: Size }) => void = () => {};
    rotate = (next) => {
      window = next;
      listener({ window, screen: window });
    };
    app = await render(mod['SafeAreaToggleHost'] as Type<Host>, {
      providers: [
        {
          provide: Screen.SOURCE,
          useValue: {
            current: () => ({ window, screen: window }),
            subscribe: (fn: typeof listener) => ((listener = fn), () => {}),
          },
        },
      ],
    });
  });

  afterEach(() => cleanup());

  it('lets go of what it measured, so the window follows a rotation again', async () => {
    const area = app.componentRef.injector.get(SafeArea);
    await fireEvent(screen.getByTestId('first'), 'insetsChange', {
      insets: NOTCH,
      frame: PORTRAIT,
    });
    assert.ok(screen.queryByText('402x874'));

    app.instance.first.set(false);
    await app.detectChanges();
    rotate({ width: 874, height: 402 });
    await app.detectChanges();

    assert.ok(
      screen.queryByText('874x402'),
      'the rotated window, not the frame of a gone provider',
    );
    assert.equal(area.frame(), null);
    assert.equal(area.known(), false);
    assert.deepEqual(area.insets(), { top: 0, right: 0, bottom: 0, left: 0 });
    assert.equal(
      screen.getByTestId('floating').props['marginBottom'],
      0,
      'and so does the stylesheet',
    );
  });

  it('takes what a provider created again reports', async () => {
    const area = app.componentRef.injector.get(SafeArea);
    await fireEvent(screen.getByTestId('first'), 'insetsChange', {
      insets: NOTCH,
      frame: PORTRAIT,
    });
    app.instance.first.set(false);
    await app.detectChanges();
    app.instance.first.set(true);
    await app.detectChanges();

    await fireEvent(screen.getByTestId('first'), 'insetsChange', {
      insets: { top: 0, right: 59, bottom: 21, left: 59 },
      frame: { x: 0, y: 0, width: 874, height: 402 },
    });

    assert.ok(screen.queryByText('874x402'));
    assert.equal(area.insets().left, 59);
  });

  it('keeps what another provider reported after it', async () => {
    // A screen being replaced is destroyed after the one replacing it has laid out.
    const area = app.componentRef.injector.get(SafeArea);
    app.instance.second.set(true);
    await app.detectChanges();
    await fireEvent(screen.getByTestId('first'), 'insetsChange', {
      insets: NOTCH,
      frame: PORTRAIT,
    });
    await fireEvent(screen.getByTestId('second'), 'insetsChange', {
      insets: NOTCH,
      frame: { x: 0, y: 0, width: 402, height: 800 },
    });

    app.instance.first.set(false);
    await app.detectChanges();

    assert.ok(screen.queryByText('402x800'));
    assert.equal(area.insets().top, 59);
    assert.equal(screen.getByTestId('floating').props['marginBottom'], 34);
  });

  it('goes back to what a provider still up last reported when the newer one goes', async () => {
    // A second provider that reports, inside a screen that is then popped, over the root one.
    const area = app.componentRef.injector.get(SafeArea);
    app.instance.second.set(true);
    await app.detectChanges();
    await fireEvent(screen.getByTestId('first'), 'insetsChange', {
      insets: NOTCH,
      frame: PORTRAIT,
    });
    await fireEvent(screen.getByTestId('second'), 'insetsChange', {
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      frame: { x: 0, y: 0, width: 402, height: 600 },
    });

    app.instance.second.set(false);
    await app.detectChanges();

    assert.ok(screen.queryByText('402x874'), 'the frame of the provider still up');
    assert.deepEqual(area.insets(), NOTCH);
    assert.equal(screen.getByTestId('floating').props['marginBottom'], 34);
  });

  it('puts back the latest report of the providers still up, never one that went', () => {
    const area = app.componentRef.injector.get(SafeArea);
    const [a, b, c] = [{}, {}, {}];
    const frame = (height: number) => ({ x: 0, y: 0, width: 402, height });
    area.report(NOTCH, frame(1), a);
    area.report(NOTCH, frame(2), b);
    area.report(NOTCH, frame(3), a);
    area.report(NOTCH, frame(4), c);

    assert.equal(area.withdraw(c), true);
    assert.equal(area.frame()?.height, 3, 'what a reported last, after b');
    assert.equal(area.withdraw(b), false, 'not the latest, so nothing changes');
    assert.equal(area.frame()?.height, 3);
    assert.equal(area.withdraw(a), true);
    assert.equal(area.frame(), null, 'b went before, so nothing is left');
  });

  it('commits nothing more as the app it reported in is destroyed', async () => {
    await fireEvent(screen.getByTestId('first'), 'insetsChange', {
      insets: NOTCH,
      frame: PORTRAIT,
    });
    const commits = app.fabric.calls.completeRoot;

    app.unmount();

    assert.equal(app.fabric.calls.completeRoot, commits, 'no restyle of a tree on its way out');
  });
});
