/**
 * A drag a library keeps from the page: a `touchmove` whose default a listener prevents stops the
 * page scrolling under the finger, as a slider, a carousel or a chart's pan asks a browser to,
 * until the finger lifts. A passive listener asks nothing.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, Renderer2 } from '@angular/core';
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

/** A template's listener on the document, passive there as a browser has it. */
@Component({
  template: `<div testID="page" style="overflow: auto">
    <div id="slider" testID="slider"></div>
  </div>`,
  host: { '(document:touchmove)': 'told($event)' },
})
class Listening {
  seen: boolean | undefined;
  told(event: Dom) {
    event.preventDefault();
    this.seen = event.defaultPrevented;
  }
}

const page = async (component: new () => object = Page) => {
  const app = await render(component, { providers: [provideWebCompat()] });
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
  const scrolls = (id = 'page') => {
    engine.commit();
    return screen.getByTestId(id).props['scrollEnabled'] !== false;
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
  return { app, document, slider, around: slider.parentNode, drag, send, scrolls };
};

const prevent = (event: Dom) => event.preventDefault();

/** A slider in a carousel, in a page: a scroll view in a scroll view. */
@Component({
  template: `<div testID="outer" style="overflow: auto">
    <div testID="page" style="overflow: auto">
      <div id="slider" testID="slider"></div>
    </div>
  </div>`,
})
class Nested {}

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

  it('stops every scroll view the slider is in, and gives each back', async () => {
    const { slider, send, scrolls } = await page(Nested);
    slider.addEventListener('touchmove', prevent);
    send('Start', 10);
    send('Move', 40);
    assert.deepEqual([scrolls('page'), scrolls('outer')], [false, false]);
    send('End', 40);
    assert.deepEqual([scrolls('page'), scrolls('outer')], [true, true]);
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
    // A passive listener's preventDefault is ignored, so the later listener does not hold the drag.
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

  it('keeps the default a document listener that froze its event prevented, for the next', async () => {
    const { document, drag } = await page();
    const seen: boolean[] = [];
    document.addEventListener(
      'touchmove',
      (event: Dom) => {
        Object.freeze(event);
        event.preventDefault();
        seen.push(event.defaultPrevented);
      },
      { passive: false },
    );
    document.body.addEventListener('touchmove', (event: Dom) => seen.push(event.defaultPrevented), {
      passive: false,
    });
    const { during } = drag();
    assert.equal(seen[0], true, 'prevented, frozen as it is');
    assert.equal(seen.at(-1), true, 'and so to the listener after it');
    assert.equal(during, false);
  });

  it('stops it for a document touchmove listener after a pointermove one that prevented its own', async () => {
    // One native move is both events here; in a browser each is its own, prevented apart.
    const { document, drag } = await page();
    const seen: boolean[] = [];
    document.addEventListener('pointermove', prevent);
    document.addEventListener(
      'touchmove',
      (event: Dom) => {
        seen.push(event.defaultPrevented);
        event.preventDefault();
      },
      { passive: false },
    );
    assert.deepEqual(drag(), { during: false, after: true });
    assert.deepEqual(seen, [false]);
  });

  it("stops it for a listener that prevents it after a passive one's preventDefault", async () => {
    const { slider, around, drag } = await page();
    slider.addEventListener('touchmove', prevent, { passive: true });
    around.addEventListener('touchmove', prevent);
    assert.deepEqual(drag(), { during: false, after: true });
  });

  it('stops it for a listener after a passive one that froze its event and prevented it', async () => {
    const { slider, around, drag } = await page();
    const seen: boolean[] = [];
    slider.addEventListener(
      'touchmove',
      (event: Dom) => {
        Object.freeze(event);
        event.preventDefault();
        seen.push(event.defaultPrevented);
      },
      { passive: true },
    );
    around.addEventListener('touchmove', prevent);
    // What the app reports: nothing, where giving the event back once it was frozen threw.
    const reported: unknown[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => void reported.push(args);
    try {
      assert.deepEqual(drag(), { during: false, after: true });
    } finally {
      console.error = error;
    }
    assert.deepEqual(seen, [false]);
    assert.deepEqual(reported, []);
  });

  it('stops it for a listener that prevented it and then threw', async () => {
    const { slider, drag } = await page();
    slider.addEventListener('touchmove', (event: Dom) => {
      event.preventDefault();
      throw new Error('after preventing');
    });
    assert.deepEqual(drag(), { during: false, after: true });
  });

  it('stops it for a window listener that says it is not passive, and not for one that does not', async () => {
    const { drag } = await page();
    const window = globalThis as Dom;
    try {
      window.addEventListener('touchmove', prevent);
      assert.deepEqual(drag(), { during: true, after: true });
      window.removeEventListener('touchmove', prevent);
      window.addEventListener('touchmove', prevent, { passive: false });
      assert.deepEqual(drag(), { during: false, after: true });
    } finally {
      window.removeEventListener('touchmove', prevent);
    }
  });

  it('stops it for a document listener a script added through the renderer as not passive', async () => {
    // As CDK's drag and drop keeps a drag from the page: with `Renderer2.listen`, not the document.
    const { app, document, drag } = await page();
    const renderer = app.componentRef.injector.get(Renderer2);
    const stop = renderer.listen(document, 'touchmove', prevent, { passive: false });
    try {
      assert.deepEqual(drag(), { during: false, after: true });
    } finally {
      stop();
    }
    assert.deepEqual(drag(), { during: true, after: true }, 'and not once it is removed');
  });

  it("leaves the default of a move a template's document listener prevented unprevented", async () => {
    const { app, drag } = await page(Listening);
    drag();
    assert.equal((app.componentRef.instance as Listening).seen, false);
  });
});
