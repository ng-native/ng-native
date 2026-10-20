/**
 * A drag a library keeps from the page: a `touchmove` whose default a listener prevents stops the
 * page scrolling under the finger, as a slider, a carousel or a chart's pan asks a browser to,
 * until the finger lifts. A passive listener asks nothing.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { cleanup, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

afterEach(cleanup);

type Dom = any;

@Component({
  template: `<div testID="page" style="overflow: auto">
    <div id="slider" testID="slider"></div>
  </div>`,
})
class Page {}

const page = async () => {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  const engine = app.componentRef.injector.get(Engine);
  const document = (globalThis as Dom).document;
  /** A finger on the slider, at this place along it. */
  const send = (phase: 'Start' | 'Move' | 'End', x: number) => {
    const slider = screen.getByTestId('slider');
    const touch = { identifier: 0, target: slider.reactTag, pageX: x, pageY: 10 };
    app.fabric.emit(slider, `topTouch${phase}`, {
      ...touch,
      touches: phase === 'End' ? [] : [touch],
      changedTouches: [touch],
    });
  };
  /** Whether the page may scroll, as native was last told. */
  const scrolls = () => {
    engine.commit();
    return screen.getByTestId('page').props['scrollEnabled'] !== false;
  };
  /** A drag across the slider, and whether the page could scroll while it was on. */
  const drag = () => {
    send('Start', 10);
    send('Move', 40);
    const during = scrolls();
    send('End', 40);
    return { during, after: scrolls() };
  };
  const slider = document.getElementById('slider');
  return { document, slider, around: slider.parentNode, drag };
};

const prevent = (event: Dom) => event.preventDefault();

describe('@ng-native/web-compat, a drag kept from the page', () => {
  it('stops the page scrolling for a drag whose touchmove a listener prevented', async () => {
    const { slider, drag } = await page();
    slider.addEventListener('touchmove', prevent);
    assert.deepEqual(drag(), { during: false, after: true });
  });

  it('leaves the page to scroll for a drag whose pointermove a listener prevented', async () => {
    // As Chrome has it: only a touchmove's default is the scroll. A pointer's is kept from the
    // page by touch-action.
    const { slider, drag } = await page();
    slider.addEventListener('pointermove', prevent);
    assert.deepEqual(drag(), { during: true, after: true });
  });

  it('stops it for a document listener that says it is not passive', async () => {
    const { document, drag } = await page();
    document.addEventListener('touchmove', prevent, { passive: false });
    assert.deepEqual(drag(), { during: false, after: true });
  });

  it('leaves it to scroll for a passive listener, or one that prevents nothing', async () => {
    const { document, slider, drag } = await page();
    // On the document a touch listener is passive unless it says otherwise, as a browser has it.
    document.addEventListener('touchmove', prevent);
    slider.addEventListener('touchmove', prevent, { passive: true });
    slider.addEventListener('pointermove', () => {});
    assert.deepEqual(drag(), { during: true, after: true });
  });

  it('leaves it to scroll for a listener after one that prevented it passively', async () => {
    const { slider, around, drag } = await page();
    slider.addEventListener('touchmove', prevent, { passive: true });
    // Prevented when it is told, by one that could not: it keeps nothing it did not prevent.
    around.addEventListener('touchmove', () => {});
    assert.deepEqual(drag(), { during: true, after: true });
  });

  it('leaves the default of a move a passive document listener prevented unprevented', async () => {
    const { document, drag } = await page();
    const seen: Record<string, boolean> = {};
    const told = (by: string) => (event: Dom) => {
      event.preventDefault();
      seen[by] = event.defaultPrevented;
    };
    // Passive there unless it says otherwise, as a browser has it: its preventDefault does nothing.
    document.addEventListener('touchmove', told('passive'));
    document.body.addEventListener('touchmove', told('not passive'), { passive: false });
    drag();
    assert.deepEqual(seen, { passive: false, 'not passive': true });
  });
});
