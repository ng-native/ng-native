/**
 * How far a finger may wander during a tap.
 *
 * RN cancels a press when the touch leaves the view's bounds plus a retention offset, not when it
 * has moved some fixed distance from where it started. The difference is the whole story on a
 * large control: a 15pt threshold cancels an ordinary thumb tap on a full-width button, which
 * reads as "the button doesn't work", intermittently.
 */
import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, fireEvent, render, screen, type RenderResult } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

describe('press tolerance', () => {
  let Component: Type<unknown>;
  let result: RenderResult<{ presses: number }>;

  before(async () => {
    const mod = await compileFixture('fixtures/active.ts');
    Component = mod['Active'] as Type<unknown>;
  });

  const btn = () => screen.getByTestId('btn');
  const touch = (type: string, x: number, y: number) =>
    fireEvent(btn(), type, {
      touches: type === 'topTouchEnd' ? [] : [{ pageX: x, pageY: y }],
      changedTouches: [{ pageX: x, pageY: y }],
      pageX: x,
      pageY: y,
    });

  beforeEach(async () => {
    result = await render(Component as Type<{ presses: number }>);
    // A wide, short control, as a full-width button is.
    await fireEvent(btn(), 'topLayout', { layout: { x: 0, y: 0, width: 360, height: 48 } });
  });

  const presses = () => result.instance.presses;

  it('still fires when the finger wanders well inside the control', async () => {
    await touch('topTouchStart', 100, 100);
    await touch('topTouchMove', 112, 120);
    await touch('topTouchEnd', 112, 120);
    assert.equal(presses(), 1, '22pt of wander inside a 360x48 control is still a tap');
    cleanup();
  });

  it('does not fire once the finger leaves the control and its retention offset', async () => {
    await touch('topTouchStart', 100, 100);
    await touch('topTouchMove', 100, 260);
    await touch('topTouchEnd', 100, 260);
    assert.equal(presses(), 0, 'a drag far outside is a scroll, not a tap');
    cleanup();
  });

  it('falls back to a small threshold before the control has been measured', async () => {
    // No layout yet: nothing is known about the bounds, so err towards the old behaviour rather
    // than letting a drag anywhere count as a press.
    cleanup();
    result = await render(Component as Type<{ presses: number }>);
    await touch('topTouchStart', 100, 100);
    await touch('topTouchMove', 100, 160);
    await touch('topTouchEnd', 100, 160);
    assert.equal(presses(), 0);
    cleanup();
  });
});

describe('press retention is not symmetric', () => {
  // A thumb rolls downwards as it lifts, so RN allows more room below the control than above.
  let Component: Type<unknown>;
  let result: RenderResult<{ presses: number }>;

  before(async () => {
    const mod = await compileFixture('fixtures/active.ts');
    Component = mod['Active'] as Type<unknown>;
  });

  const btn = () => screen.getByTestId('btn');
  const touch = (type: string, x: number, y: number) =>
    fireEvent(btn(), type, {
      touches: type === 'topTouchEnd' ? [] : [{ pageX: x, pageY: y }],
      changedTouches: [{ pageX: x, pageY: y }],
      pageX: x,
      pageY: y,
    });
  const presses = () => result.instance.presses;

  beforeEach(async () => {
    result = await render(Component as Type<{ presses: number }>);
    await fireEvent(btn(), 'topLayout', { layout: { x: 0, y: 0, width: 360, height: 48 } });
  });

  it('keeps a press that drifts 72pt downwards on a 48pt control', async () => {
    await touch('topTouchStart', 100, 100);
    await touch('topTouchMove', 100, 172);
    await touch('topTouchEnd', 100, 172);
    assert.equal(presses(), 1);
    cleanup();
  });

  it('drops the same drift upwards', async () => {
    await touch('topTouchStart', 100, 100);
    await touch('topTouchMove', 100, 28);
    await touch('topTouchEnd', 100, 28);
    assert.equal(presses(), 0);
    cleanup();
  });
});

describe('pressables configured the less usual ways', () => {
  let Component: Type<unknown>;
  let result: RenderResult<{ counts: Record<string, number> }>;

  before(async () => {
    const mod = await compileFixture('fixtures/press-options.ts');
    Component = mod['PressOptions'] as Type<unknown>;
  });

  beforeEach(async () => {
    result = await render(Component as Type<{ counts: Record<string, number> }>);
    for (const id of ['wide', 'left', 'below']) {
      await fireEvent(screen.getByTestId(id), 'topLayout', {
        layout: { x: 0, y: 0, width: 360, height: 48 },
      });
    }
  });

  const drag = async (id: string, dx: number, dy: number) => {
    const at = (x: number, y: number, end = false) => ({
      touches: end ? [] : [{ pageX: x, pageY: y }],
      changedTouches: [{ pageX: x, pageY: y }],
      pageX: x,
      pageY: y,
    });
    await fireEvent(screen.getByTestId(id), 'topTouchStart', at(400, 100));
    await fireEvent(screen.getByTestId(id), 'topTouchMove', at(400 + dx, 100 + dy));
    await fireEvent(screen.getByTestId(id), 'topTouchEnd', at(400 + dx, 100 + dy, true));
  };
  const counted = (name: string) => result.instance.counts[name] ?? 0;

  it('takes a number as the retention offset on every side', async () => {
    await drag('wide', 0, 120);
    assert.equal(counted('wide'), 1, '120pt down stays inside 48pt and 100pt of retention');
    cleanup();
  });

  it('adds hit slop on the side it names only', async () => {
    await drag('left', -400, 0);
    assert.equal(counted('left'), 1, 'the left slop widens the left edge');
    await drag('below', 0, 110);
    assert.equal(counted('below'), 1, 'and the bottom slop the bottom one');
    cleanup();
  });

  it('reads the touch point from the touch list when the event has no page coordinates', async () => {
    const node = () => screen.getByTestId('wide');
    await fireEvent(node(), 'topTouchStart', { touches: [{ pageX: 100, pageY: 100 }] });
    await fireEvent(node(), 'topTouchMove', { touches: [{ pageX: 900, pageY: 100 }] });
    await fireEvent(node(), 'topTouchEnd', { touches: [], changedTouches: [] });
    assert.equal(counted('wide'), 0, 'dragged 800pt sideways, so no press');
    cleanup();
  });

  it('draws an Android ripple in front or behind, as it was asked, and aims it at the touch', async () => {
    assert.equal(screen.getByTestId('front').props['nativeBackgroundAndroid'], undefined);
    assert.equal(
      (screen.getByTestId('front').props['nativeForegroundAndroid'] as { type: string }).type,
      'RippleAndroid',
    );
    assert.equal(screen.getByTestId('behind').props['nativeForegroundAndroid'], undefined);

    await fireEvent(screen.getByTestId('front'), 'topTouchStart', { pageX: 12, pageY: 34 });
    assert.ok(
      result.fabric.commands.some(
        (command) => command.name === 'hotspotUpdate' && command.args[0] === 12,
      ),
    );
    cleanup();
  });

  it('holds back press-in for its delay, and fires nothing after the pressable is gone', async () => {
    await fireEvent(screen.getByTestId('slow'), 'topTouchStart', { pageX: 1, pageY: 1 });
    assert.equal(counted('slowIn'), 0, 'not yet');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(counted('slowIn'), 1);
    const counts = result.instance.counts;
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(counts['slowLong'] ?? 0, 0, 'the long-press timer died with it');
  });
});
