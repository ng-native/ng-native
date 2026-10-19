/**
 * Where an element is, how big, and how far it is scrolled, as a library positioning an overlay
 * or a virtual list reads them: `getBoundingClientRect`, `offset*`, `client*`, `scroll*`,
 * `scrollIntoView`, the window's size, `matchMedia` and the observers. Native's frames are set by hand: nothing is laid out
 * under Node.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, Renderer2, inject } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { cleanup, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

afterEach(cleanup);

/** What a library sees: loosely typed, as its own code would be against the DOM. */
type Dom = any;
type Frame = { x: number; y: number; width: number; height: number };

@Component({ selector: 'x-page', template: '' })
class Page {
  readonly renderer = inject(Renderer2);
}

const globals = globalThis as Dom;
let made = 0;

/** An empty page, and a way to say where native laid an element out. */
async function page() {
  const app = await render(Page, {
    providers: [provideWebCompat()],
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });
  const engine = app.componentRef.injector.get(Engine);
  const document = globals.document as Dom;
  const idOf = (element: Dom): string => {
    if (!element.getAttribute('nativeID')) element.setAttribute('nativeID', `n${made++}`);
    return element.getAttribute('nativeID');
  };
  const place = (element: Dom, frame: Frame) => {
    app.fabric.frames.set(idOf(element), frame);
  };
  /** An element as a template makes one, with what a browser gives it for its name. */
  const make = (name: string, parent: Dom = document.body, style = '') => {
    const element = app.instance.renderer.createElement(name);
    for (const declaration of style.split(';').filter(Boolean)) {
      const [property = '', value = ''] = declaration.split(':');
      element.style.setProperty(property.trim(), value.trim());
    }
    parent.appendChild(element);
    return element;
  };
  const div = (parent?: Dom, style?: string) => make('div', parent, style);
  /** Native says an element that scrolls has been scrolled. */
  const scrolled = async (element: Dom, x: number, y: number) => {
    element.setAttribute('testID', idOf(element));
    await settle();
    app.fabric.emit(screen.getByTestId(idOf(element)), 'topScroll', { contentOffset: { x, y } });
  };
  const sent = () =>
    app.fabric.commands
      .filter((command) => command.name === 'scrollTo')
      .map((command) => command.args);
  return { app, engine, document, place, make, div, scrolled, sent };
}

/** Whether two nodes are one: compared so a failure prints no tree. */
const same = (actual: unknown, expected: unknown, message = 'the same node') =>
  assert.equal(actual === expected, true, message);
const sides = (rect: Dom) => [rect.left, rect.top, rect.right, rect.bottom].join(' ');

describe('getBoundingClientRect and getClientRects', () => {
  it('answers a DOMRect, which a library can make one of too', async () => {
    const { place, div } = await page();
    const box = div();
    await settle();
    place(box, { x: 10, y: 20, width: 30, height: 40 });
    const rect = box.getBoundingClientRect();
    assert.equal(rect instanceof globals.DOMRect, true);
    assert.equal(Object.prototype.toString.call(rect), '[object DOMRect]');
    assert.equal(sides(rect), '10 20 40 60');
    assert.equal(JSON.stringify(rect), JSON.stringify(rect.toJSON()));
    assert.equal(rect.toJSON().bottom, 60);
    const own = new globals.DOMRect(5, 5, -10, 20);
    assert.equal(sides(own), '-5 5 5 25', 'a negative width has its left at the smaller edge');
    own.x = 0;
    assert.equal(own.right, 0);
    assert.equal(globals.DOMRectReadOnly.fromRect({ width: 3 }).right, 3);
  });

  it('is nothing for an element that is not drawn', async () => {
    const { document, place, div } = await page();
    const hidden = div(undefined, 'display: none');
    const inside = div(hidden);
    const loose = document.createElement('div');
    await settle();
    place(hidden, { x: 10, y: 20, width: 30, height: 40 });
    place(inside, { x: 10, y: 20, width: 30, height: 40 });
    assert.equal(sides(inside.getBoundingClientRect()), '0 0 0 0');
    assert.equal(sides(hidden.getBoundingClientRect()), '0 0 0 0');
    assert.equal(hidden.getClientRects().length, 0);
    assert.equal(inside.getClientRects().length, 0);
    assert.equal(loose.getClientRects().length, 0);
  });

  it('lists the box an element is drawn in as a DOMRectList', async () => {
    const { place, div } = await page();
    const box = div();
    await settle();
    place(box, { x: 1, y: 2, width: 3, height: 4 });
    const rects = box.getClientRects();
    assert.equal(Object.prototype.toString.call(rects), '[object DOMRectList]');
    assert.equal(rects.length, 1);
    assert.equal(rects.item(0).bottom, 6);
    assert.equal(rects[0].right, 4);
    assert.equal([...rects].length, 1);
  });
});

describe('offset and client members', () => {
  it('places an element in the nearest box that is not static, a table cell, or the body', async () => {
    // A native view is positioned, as one is placed against it: one that says `static` is not.
    const { document, make, div } = await page();
    const plain = div();
    const placed = div(undefined, 'position: relative');
    const inPlaced = div(div(placed, 'position: static'), 'position: static');
    const table = make('table', undefined, 'position: static');
    const cell = make('td', make('tr', table, 'position: static'), 'position: static');
    const inCell = div(div(cell, 'position: static'), 'position: static');
    const placedInCell = div(cell, 'position: absolute');
    const inParent = div(placed);
    const fixed = div(placed, 'position: fixed');
    const hidden = div(placed, 'display: none');
    await settle();
    same(document.documentElement.offsetParent, null);
    same(document.body.offsetParent, null);
    same(make('body', div()).offsetParent, null, 'nor any other body');
    same(plain.offsetParent, document.body);
    same(inPlaced.offsetParent, placed);
    same(inCell.offsetParent, cell, 'a cell holds what is static itself');
    same(placedInCell.offsetParent, document.body, 'and not what is placed');
    same(inParent.offsetParent, placed);
    same(fixed.offsetParent, null);
    same(hidden.offsetParent, null, 'nor one not drawn');
    same(document.createElement('div').offsetParent, null, 'nor one in no page');
  });

  it('measures offsets from the padding edge of what an element is placed in', async () => {
    const { place, div } = await page();
    const outer = div(undefined, 'position: relative; border-width: 3px; border-style: solid');
    const inner = div(outer);
    const fixed = div(outer, 'position: fixed');
    await settle();
    place(outer, { x: 10, y: 100, width: 200, height: 200 });
    place(inner, { x: 13, y: 120, width: 50, height: 50 });
    place(fixed, { x: 7, y: 9, width: 5, height: 5 });
    assert.equal(inner.offsetTop, 17);
    assert.equal(inner.offsetLeft, 0);
    assert.equal(fixed.offsetTop, 9, 'with nothing it is placed in, from the window');
    assert.equal(fixed.offsetLeft, 7);
  });

  it('measures an offset as it is laid out, however far what it is in is scrolled', async () => {
    const { place, div, scrolled } = await page();
    const scroller = div(undefined, 'position: relative; overflow: auto; height: 100px');
    const inner = div(scroller, 'overflow: auto');
    const child = div(inner);
    await settle();
    // Heard from the first time it is asked: see `scrollOf`.
    assert.equal(scroller.scrollTop + inner.scrollTop, 0);
    await scrolled(scroller, 0, 100);
    await scrolled(inner, 4, 10);
    place(scroller, { x: 0, y: 50, width: 100, height: 100 });
    place(inner, { x: 0, y: -50, width: 100, height: 300 });
    // Laid out 200 down and 20 across, drawn where the two scrolls have moved it.
    place(child, { x: 16, y: 140, width: 10, height: 10 });
    assert.equal(child.offsetTop, 200);
    assert.equal(child.offsetLeft, 20);
  });

  it('leaves the border out of the client size, and says the border is where it starts', async () => {
    const { document, place, div } = await page();
    const box = div(undefined, 'border-width: 2px; border-left-width: 5px; border-style: solid');
    const hidden = div(undefined, 'display: none');
    await settle();
    place(box, { x: 0, y: 0, width: 100, height: 50 });
    place(hidden, { x: 0, y: 0, width: 100, height: 50 });
    assert.equal(box.offsetWidth, 100);
    assert.equal(box.clientWidth, 93);
    assert.equal(box.clientHeight, 46);
    assert.equal(box.clientLeft, 5);
    assert.equal(box.clientTop, 2);
    assert.equal(hidden.clientWidth, 0);
    assert.equal(hidden.offsetWidth, 0);
    assert.equal(document.documentElement.clientWidth, 400, "the root's is the window's");
    assert.equal(document.documentElement.clientHeight, 800);
  });

  it('rounds each size and offset to a whole pixel, as a browser does, where a getter reads one', async () => {
    // A 1080-pixel Android screen at 2.625 is 411.43 points across: a library that sizes a
    // chart by offsetWidth draws it at 411 in a browser, and placed every line by the fraction.
    const { place, div } = await page();
    const box = div(undefined, 'position: relative; border-width: 1.25px; border-style: solid');
    const inner = div(box);
    await settle();
    place(box, { x: 0.4, y: 10.6, width: 411.4286, height: 299.81 });
    place(inner, { x: 2.1, y: 12.4, width: 405.3, height: 20.5 });
    assert.equal(box.offsetWidth, 411);
    assert.equal(box.offsetHeight, 300);
    assert.equal(box.clientWidth, 409);
    assert.equal(box.clientTop, 1);
    assert.equal(inner.offsetLeft, 0);
    assert.equal(inner.offsetTop, 1);
    assert.equal(box.scrollWidth, 409);
    assert.equal(box.getBoundingClientRect().width, 411.4286, 'a rectangle keeps the fraction');
  });

  it('measures what an element holds from its padding edge, past its start and not before', async () => {
    const { place, div } = await page();
    const box = div(undefined, 'border-width: 3px; border-left-width: 5px; border-style: solid');
    const inner = div(box);
    const deeper = div(inner);
    const clipped = div(box, 'overflow: hidden');
    const inClipped = div(clipped);
    await settle();
    place(box, { x: 100, y: 100, width: 100, height: 50 });
    place(inner, { x: 50, y: 90, width: 20, height: 20 });
    place(deeper, { x: 150, y: 120, width: 80, height: 50 });
    place(clipped, { x: 105, y: 103, width: 10, height: 10 });
    place(inClipped, { x: 105, y: 103, width: 500, height: 500 });
    // With nothing reaching past it, the padding box: the border is not what it holds.
    const lone = div(undefined, 'border-width: 3px; border-style: solid');
    await settle();
    place(lone, { x: 0, y: 0, width: 40, height: 30 });
    assert.equal(lone.scrollWidth, 34);
    assert.equal(lone.scrollHeight, 24);
    // Out to the end of what is inside what it holds, but not what one that clips holds, and
    // what reaches before its start is not counted.
    assert.equal(box.scrollWidth, 125, 'to 230 from 105');
    assert.equal(box.scrollHeight, 67, 'to 170 from 103');
  });
});

describe('a drawn size in getComputedStyle', () => {
  it('is where native laid an element out, inside its padding and border, read each time', async () => {
    const { place, div } = await page();
    const box = div(undefined, 'padding: 4px 8px; border-width: 1px; border-style: solid');
    const sized = div(undefined, 'width: 30px; box-sizing: border-box; padding: 2px');
    const hidden = div(undefined, 'display: none');
    const inHidden = div(hidden);
    await settle();
    place(box, { x: 0, y: 0, width: 100, height: 50 });
    place(hidden, { x: 0, y: 0, width: 100, height: 50 });
    place(inHidden, { x: 0, y: 0, width: 100, height: 50 });
    const style = globals.getComputedStyle(box);
    assert.deepEqual([style.width, style.height], ['82px', '40px']);
    place(box, { x: 0, y: 0, width: 120, height: 50 });
    assert.equal(style.width, '102px', 'laid out again, measured again');
    box.style.boxSizing = 'border-box';
    assert.equal(globals.getComputedStyle(box).width, '120px', 'the whole box, for border-box');
    assert.equal(globals.getComputedStyle(sized).width, '30px', 'its own, where it has one');
    assert.equal(globals.getComputedStyle(hidden).width, 'auto', 'and none where it is not drawn');
    assert.equal(globals.getComputedStyle(inHidden).width, 'auto', 'nor inside what is not');
    box.style.display = 'contents';
    assert.equal(globals.getComputedStyle(box).width, 'auto');
  });
});

describe('scrolling an element', () => {
  it('scrolls an element a script made, where its style says it scrolls', async () => {
    const { document, sent } = await page();
    const box = document.createElement('div');
    box.style.overflow = 'auto';
    box.appendChild(document.createElement('div'));
    document.body.appendChild(box);
    await settle();
    box.scrollTop = 30;
    assert.deepEqual(sent().at(-1), [0, 30, false]);
    assert.equal(box.scrollTop, 30);
  });

  it("leaves the engine's own views, a component and a text field to scroll as they do", async () => {
    const { make } = await page();
    const scrolls = (name: string) => make(name).scrollsOverflow === true;
    assert.deepEqual(['div', 'span', 'td', 'x-mine', 'view', 'input', 'textarea'].map(scrolls), [
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    // A library's own element, which the build names as a browser's.
    const named = globals.ɵngNativeBrowserElements;
    globals.ɵngNativeBrowserElements = new Set(['x-library']);
    try {
      assert.equal(scrolls('x-library'), true);
    } finally {
      if (named === undefined) delete globals.ɵngNativeBrowserElements;
      else globals.ɵngNativeBrowserElements = named;
    }
  });

  it('has an element that does not scroll at the top, and leaves it there', async () => {
    const { document, div, sent } = await page();
    const box = div();
    await settle();
    box.scrollTop = 10;
    box.scrollLeft = 10;
    assert.equal(box.scrollTop, 0);
    assert.equal(box.scrollLeft, 0);
    assert.equal(sent().length, 0, 'nothing is sent to a view that cannot scroll');
    // The page itself: the window does not scroll here.
    same(document.scrollingElement, document.documentElement);
    document.scrollingElement.scrollTop = 300;
    assert.equal(document.scrollingElement.scrollTop, 0);
  });

  it('scrolls an element that does as soon as it is told, written in the same turn', async () => {
    const { div, sent } = await page();
    const box = div();
    await settle();
    box.style.overflow = 'auto';
    box.scrollTop = 40;
    assert.deepEqual(sent().at(-1), [0, 40, false]);
    box.scrollTop = Number.NaN;
    assert.deepEqual(sent().at(-1), [0, 0, false], 'a number that is none is zero');
    box.scrollLeft = -5;
    assert.deepEqual(sent().at(-1), [0, 0, false], 'and nothing scrolls back past the start');
  });

  it('scrolls no further than the end of what it holds, once it is laid out', async () => {
    const { place, div, sent } = await page();
    const box = div(undefined, 'overflow: auto');
    const inside = div(box);
    await settle();
    place(box, { x: 0, y: 0, width: 100, height: 100 });
    place(inside, { x: 0, y: 0, width: 150, height: 500 });
    box.scrollTop = 1000;
    box.scrollLeft = 1000;
    assert.deepEqual(sent().at(-1), [50, 400, false]);
    assert.equal(box.scrollTop, 400);
    // Native draws what it holds where it was scrolled to.
    place(inside, { x: -50, y: -400, width: 150, height: 500 });
    box.scrollBy(0, 1000);
    assert.equal(box.scrollTop, 400);
  });

  it('starts a view native made again at the top, where it stopped scrolling or was put back', async () => {
    const { document, div, scrolled } = await page();
    const box = div(undefined, 'overflow: auto');
    await settle();
    // Heard from the first time it is asked: see `scrollOf`.
    assert.equal(box.scrollTop, 0);
    await scrolled(box, 0, 50);
    assert.equal(box.scrollTop, 50);
    box.style.overflow = 'visible';
    await settle();
    assert.equal(box.scrollTop, 0, 'what does not scroll is at the top');
    box.style.overflow = 'auto';
    await settle();
    assert.equal(box.scrollTop, 0, 'and its new scroll view starts there');
    await scrolled(box, 0, 70);
    assert.equal(box.scrollTop, 70);
    box.remove();
    await settle();
    document.body.appendChild(box);
    await settle();
    assert.equal(box.scrollTop, 0, 'put back in the page, a view is made again');
  });

  it('takes the arguments scroll, scrollTo and scrollBy take, and answers a promise', async () => {
    const { div, sent, scrolled } = await page();
    const box = div(undefined, 'overflow: auto');
    await settle();
    await scrolled(box, 10, 20);
    await box.scroll(5, 6);
    assert.deepEqual(sent().at(-1), [5, 6, false]);
    await box.scrollTo({ top: 50 });
    assert.deepEqual(sent().at(-1), [5, 50, false]);
    await box.scrollBy({ left: 10, behavior: 'smooth' });
    assert.deepEqual(sent().at(-1), [15, 50, true]);
    await box.scrollBy(1, 1);
    // From where it was: a smooth scroll is where native says it is as it arrives.
    assert.deepEqual(sent().at(-1), [6, 51, false]);
    const count = sent().length;
    await box.scrollTo();
    await assert.rejects(box.scrollTo(25), TypeError);
    await assert.rejects(box.scroll({ behavior: 'abcd' }), TypeError);
    await assert.rejects(globals.scrollTo({ behavior: '' }), TypeError);
    await globals.scrollBy({ top: 5 });
    assert.equal(sent().length, count + 1, 'scrollTo() scrolls to where it is, and no more');
  });

  it('scrolls what an element is in to bring it into sight', async () => {
    const { place, div, sent, scrolled } = await page();
    const outer = div(undefined, 'overflow: auto');
    const inner = div(outer, 'overflow: auto');
    const item = div(inner);
    const spacer = div(inner);
    await settle();
    await scrolled(inner, 0, 0);
    await scrolled(outer, 0, 0);
    place(outer, { x: 0, y: 0, width: 100, height: 100 });
    place(inner, { x: 0, y: 0, width: 100, height: 100 });
    place(spacer, { x: 0, y: 0, width: 100, height: 1000 });
    place(item, { x: 0, y: 300, width: 100, height: 20 });
    // Native has it where it was each time: what is sent is from the top.
    const asked = async (arg?: unknown) => {
      await scrolled(inner, 0, 0);
      item.scrollIntoView(arg);
      return sent().at(-1);
    };
    assert.deepEqual(await asked(), [0, 300, false], 'to its start, by default');
    assert.equal(sent().length, 1, 'and only what it is in: the outer one has nothing to show');
    assert.deepEqual(await asked({ block: 'end', behavior: 'smooth' }), [0, 220, true]);
    assert.deepEqual(await asked({ block: 'center' }), [0, 260, false]);
    assert.deepEqual(await asked(false), [0, 220, false]);
    assert.deepEqual(await asked({ block: 'nearest' }), [0, 220, false], 'the least that shows it');
    await assert.rejects(item.scrollIntoView({ block: 'top' }), TypeError);
    // In sight already: `nearest` leaves it where it is.
    place(item, { x: 0, y: 30, width: 100, height: 20 });
    const count = sent().length;
    item.scrollIntoView({ block: 'nearest' });
    assert.equal(sent().length, count);
  });
});

describe('window geometry', () => {
  it('has a screen, a pixel ratio and a visual viewport the size of the window', async () => {
    await page();
    assert.equal(globals.screen.width, 400);
    assert.equal(globals.screen.availHeight, 800);
    assert.equal(globals.screen.colorDepth, 24);
    assert.equal(globals.screen.pixelDepth, 24);
    assert.equal(globals.outerWidth, 400);
    assert.equal(globals.screenX, 0);
    assert.equal(globals.visualViewport.width, 400);
    assert.equal(globals.visualViewport.height, 800);
    assert.equal(globals.visualViewport.scale, 1);
    assert.equal(globals.visualViewport.offsetTop, 0);
  });

  it('tells a visual viewport resize listener when the window changes', async () => {
    const { engine } = await page();
    const heard: number[] = [];
    const hear = () => heard.push(globals.visualViewport.width);
    globals.visualViewport.addEventListener('resize', hear);
    engine.updateConditions({ width: 500, height: 800, colorScheme: 'light' });
    globals.visualViewport.removeEventListener('resize', hear);
    engine.updateConditions({ width: 600, height: 800, colorScheme: 'light' });
    assert.deepEqual(heard, [500]);
  });
});

describe('matchMedia', () => {
  it('answers a MediaQueryList, and an empty query matches', async () => {
    await page();
    const list = globals.matchMedia('(min-width: 300px)');
    assert.equal(list instanceof globals.MediaQueryList, true);
    assert.equal(list.matches, true);
    assert.equal(globals.matchMedia('').matches, true);
    assert.equal(globals.matchMedia('(min-width: 500px)').matches, false);
  });

  it('reads a query as the engine does', async () => {
    await page();
    const matches = (media: string): boolean => globals.matchMedia(media).matches;
    assert.equal(matches('screen and (min-width: 300px) and (max-height: 800px)'), true);
    assert.equal(matches('(orientation: portrait)'), true);
    assert.equal(matches('(orientation: landscape)'), false);
    assert.equal(matches('(width >= 400px)'), true);
    assert.equal(matches('(300px < width <= 399px)'), false);
    assert.equal(matches('(min-width: 25em)'), true, 'an em is 16 pixels');
    assert.equal(matches('(min-width: 26em)'), false);
    assert.equal(matches('print'), false);
    assert.equal(matches('print, (max-width: 500px)'), true, 'any query of a list');
    assert.equal(matches('not print'), true);
    assert.equal(matches('not all and (min-width: 300px)'), false);
    assert.equal(matches('(min-width: 500px) or (orientation: portrait)'), true);
    assert.equal(matches('(min-width: 1px) and (orientation: portrait) or (hover)'), false);
    assert.equal(matches('(hover: hover)'), false, 'a feature not read matches nothing');
    assert.equal(matches('not (hover: hover)'), false, 'negated or not');
    assert.throws(() => globals.matchMedia(), TypeError);
  });

  it('answers the colour scheme and the motion the engine was given, light and none before any', async () => {
    const { engine } = await page();
    const matches = (media: string): boolean => globals.matchMedia(media).matches;
    assert.equal(matches('(prefers-color-scheme: light)'), true);
    assert.equal(matches('(prefers-color-scheme: dark)'), false);
    assert.equal(matches('not (prefers-color-scheme: dark)'), true);
    assert.equal(matches('(prefers-reduced-motion)'), false);
    assert.equal(matches('(prefers-reduced-motion: no-preference)'), true);
    const dark = globals.matchMedia('(prefers-color-scheme: dark)');
    let told = 0;
    dark.addEventListener('change', () => told++);
    engine.updateConditions({ width: 400, height: 800, colorScheme: 'dark', reducedMotion: true });
    assert.equal(dark.matches, true);
    assert.equal(told, 1, 'told when the scheme turns');
    assert.equal(matches('(prefers-color-scheme: light)'), false);
    assert.equal(matches('(prefers-reduced-motion: reduce)'), true);
    assert.equal(matches('(prefers-reduced-motion: no-preference)'), false);
  });

  it('tells each kind of listener once of a change, with a MediaQueryListEvent', async () => {
    const { engine } = await page();
    const list = globals.matchMedia('(min-width: 500px)');
    const heard: string[] = [];
    const listener = (event: Dom) =>
      heard.push(
        `fn ${event.matches} ${event.type} ${event instanceof globals.MediaQueryListEvent}`,
      );
    list.addListener(listener);
    list.addEventListener('change', listener);
    list.addEventListener('change', {
      handleEvent: (event: Dom) => heard.push(`object ${event.media}`),
    });
    list.onchange = (event: Dom) => heard.push(`on ${event.matches}`);
    engine.updateConditions({ width: 600, height: 800, colorScheme: 'light' });
    assert.deepEqual(heard, ['fn true change true', 'object (min-width: 500px)', 'on true']);
    engine.updateConditions({ width: 650, height: 800, colorScheme: 'light' });
    assert.equal(heard.length, 3, 'not told where the answer is the same');
    heard.length = 0;
    list.removeListener(listener);
    list.onchange = null;
    list.dispatchEvent(Object.assign(new globals.Event('change'), { media: 'x' }));
    assert.deepEqual(heard, ['object x']);
  });
});

/** The frame after this, and the task after that: when an observer has been told. */
const nextFrame = () =>
  new Promise((resolve) => globals.requestAnimationFrame(() => setTimeout(resolve, 0)));

describe('ResizeObserver', () => {
  it('tells of an element laid out before it was watched, in each box it is asked for', async () => {
    const { place, div } = await page();
    const box = div(undefined, 'padding: 5px; border-width: 2px; border-style: solid');
    const other = div();
    const empty = div();
    await settle();
    place(box, { x: 0, y: 0, width: 100, height: 50 });
    place(other, { x: 0, y: 0, width: 30, height: 40 });
    const calls: Dom[][] = [];
    let self: unknown;
    const observer = new globals.ResizeObserver(function (this: unknown, entries: Dom[]) {
      self = this;
      calls.push(entries);
    });
    observer.observe(box);
    observer.observe(other, { box: 'border-box' });
    observer.observe(empty);
    assert.equal(calls.length, 0, 'not from inside observe');
    await nextFrame();
    assert.equal(calls.length, 1, 'all at once');
    assert.equal(self === observer, true);
    const [first, second, third] = calls[0]!;
    assert.equal(first instanceof globals.ResizeObserverEntry, true);
    assert.equal(first.target === box, true);
    const { x, y, width, height } = first.contentRect;
    assert.deepEqual([x, y, width, height], [5, 5, 86, 36], 'inside the padding and the border');
    assert.deepEqual(
      [first.contentBoxSize[0].inlineSize, first.borderBoxSize[0].blockSize],
      [86, 50],
    );
    assert.equal(second.target === other, true);
    assert.equal(third.target === empty, true, 'one with no size too, as a browser tells it');
    assert.equal(third.contentRect.width, 0);
    await nextFrame();
    assert.equal(calls.length, 1, 'told once of a size');
  });

  it('is told again of a size that changed, until the element is let go', async () => {
    const { place, div } = await page();
    const box = div();
    await settle();
    place(box, { x: 0, y: 0, width: 10, height: 10 });
    const seen: number[] = [];
    const observer = new globals.ResizeObserver((entries: Dom[]) =>
      seen.push(...entries.map((entry) => entry.contentRect.width)),
    );
    observer.observe(box, { box: 'border-box' });
    await nextFrame();
    place(box, { x: 0, y: 0, width: 20, height: 10 });
    // Laid out again, as native says when the size changes.
    observer.observe(box, { box: 'border-box' });
    await nextFrame();
    observer.unobserve(box);
    place(box, { x: 0, y: 0, width: 30, height: 10 });
    await nextFrame();
    assert.deepEqual(seen, [10, 20]);
    assert.throws(() => observer.observe('box'), TypeError);
    assert.throws(() => observer.observe(box, { box: 'padding-box' }), TypeError);
    assert.throws(() => new globals.ResizeObserver(), TypeError);
  });

  it('tells of an element hidden or taken out of the page, and of it back again', async () => {
    const { app, place, div, document } = await page();
    const box = div();
    box.setAttribute('testID', 'watched');
    await settle();
    place(box, { x: 0, y: 0, width: 50, height: 20 });
    /** Native makes the view again, and lays it out. */
    const shown = async () => {
      await settle();
      const layout = { x: 0, y: 0, width: 50, height: 20 };
      app.fabric.emit(screen.getByTestId('watched'), 'topLayout', { layout });
      await nextFrame();
    };
    const seen: number[] = [];
    const observer = new globals.ResizeObserver((entries: Dom[]) =>
      seen.push(...entries.map((entry) => entry.contentRect.width)),
    );
    observer.observe(box);
    await nextFrame();
    // Native lays out nothing for an element hidden or taken out: the commit says it went.
    box.style.display = 'none';
    await settle();
    await nextFrame();
    box.style.display = '';
    await shown();
    box.remove();
    await settle();
    await nextFrame();
    document.body.appendChild(box);
    await shown();
    // An element that kept its view is not measured after a commit, another one hidden: given
    // another frame with no layout from native, it is not told of it until native lays it out.
    const other = div();
    const elsewhere = div();
    await settle();
    place(other, { x: 0, y: 0, width: 10, height: 20 });
    observer.observe(other);
    await nextFrame();
    place(other, { x: 0, y: 0, width: 70, height: 20 });
    elsewhere.style.display = 'none';
    await settle();
    await nextFrame();
    assert.deepEqual(seen, [50, 0, 50, 0, 50, 10]);
    observer.disconnect();
    box.style.display = 'none';
    await settle();
    await nextFrame();
    assert.deepEqual(seen, [50, 0, 50, 0, 50, 10], 'nothing once disconnected');
  });

  it('measures an element watched again afresh, not by what was heard before it was let go', async () => {
    const { app, place, div } = await page();
    const box = div();
    box.setAttribute('testID', 'again');
    await settle();
    place(box, { x: 0, y: 0, width: 50, height: 20 });
    const seen: number[] = [];
    const observer = new globals.ResizeObserver((entries: Dom[]) =>
      seen.push(...entries.map((entry) => entry.borderBoxSize[0].inlineSize)),
    );
    observer.observe(box);
    const layout = { x: 0, y: 0, width: 60, height: 20 };
    app.fabric.emit(screen.getByTestId('again'), 'topLayout', { layout });
    await nextFrame();
    observer.unobserve(box);
    // Laid out again while nothing heard it.
    place(box, { x: 0, y: 0, width: 80, height: 20 });
    assert.equal(new globals.ResizeObserverEntry(box).borderBoxSize[0].inlineSize, 80);
    observer.observe(box);
    await nextFrame();
    assert.deepEqual(seen, [60, 80]);
    observer.disconnect();
  });

  it('tells of an element watched while it is hidden, at no size', async () => {
    const { div } = await page();
    const hidden = div(undefined, 'display: none');
    await settle();
    const seen: Dom[] = [];
    const observer = new globals.ResizeObserver((entries: Dom[]) => seen.push(...entries));
    observer.observe(hidden);
    await nextFrame();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].target === hidden, true);
    assert.deepEqual({ ...seen[0].borderBoxSize[0] }, { inlineSize: 0, blockSize: 0 });
    observer.disconnect();
  });
});

describe('IntersectionObserver', () => {
  it('keeps the root, margin and thresholds it was given, as a browser writes them', async () => {
    const { div } = await page();
    const root = div();
    const plain = new globals.IntersectionObserver(() => {});
    assert.equal(plain.root, null);
    assert.deepEqual([...plain.thresholds], [0]);
    assert.equal(Object.isFrozen(plain.thresholds), true);
    assert.equal(plain.rootMargin, '0px 0px 0px 0px');
    const given = new globals.IntersectionObserver(() => {}, {
      root,
      threshold: [1, 0.25, 0],
      rootMargin: '10% 20px',
    });
    same(given.root, root);
    assert.deepEqual([...given.thresholds], [0, 0.25, 1]);
    assert.equal(given.rootMargin, '10% 20px 10% 20px');
    const make = (options: object) => () => new globals.IntersectionObserver(() => {}, options);
    assert.throws(make({ threshold: [1.1] }), RangeError);
    assert.throws(make({ threshold: ['foo'] }), TypeError);
    assert.throws(make({ rootMargin: '1' }), { name: 'SyntaxError' });
    assert.throws(make({ rootMargin: '2em' }), { name: 'SyntaxError' });
    assert.equal(make({ rootMargin: '1in 10%' })().rootMargin, '96px 10% 96px 10%');
    assert.throws(make({ rootMargin: '1px 1px 1px 1px 1px' }), { name: 'SyntaxError' });
    assert.throws(make({ root: 'root' }), TypeError);
    assert.throws(() => plain.observe('foo'), TypeError);
  });

  it('tells of each element the first time it is looked at, in sight or not', async () => {
    const { place, div } = await page();
    const near = div();
    const far = div();
    await settle();
    place(near, { x: 10, y: 10, width: 20, height: 20 });
    place(far, { x: 10, y: 900, width: 20, height: 20 });
    const calls: Dom[][] = [];
    const observer = new globals.IntersectionObserver((entries: Dom[]) => calls.push(entries));
    observer.observe(near);
    observer.observe(far);
    assert.equal(observer.takeRecords().length, 0, 'nothing until it is looked at');
    await nextFrame();
    assert.equal(calls.length, 1);
    const [first, second] = calls[0]!;
    assert.equal(first instanceof globals.IntersectionObserverEntry, true);
    assert.equal(first.target === near, true);
    assert.deepEqual([first.isIntersecting, first.intersectionRatio], [true, 1]);
    assert.equal(sides(first.boundingClientRect), '10 10 30 30');
    assert.equal(sides(first.intersectionRect), '10 10 30 30');
    assert.equal(sides(first.rootBounds), '0 0 400 800', 'the window');
    assert.equal(typeof first.time, 'number');
    assert.deepEqual([second.isIntersecting, second.intersectionRatio], [false, 0]);
    assert.equal(sides(second.intersectionRect), '0 0 0 0');
    await nextFrame();
    assert.equal(calls.length, 1, 'and not again while nothing crossed');
  });

  it('tells of a threshold crossed as what an element is in scrolls', async () => {
    const { place, div, scrolled } = await page();
    const scroller = div(undefined, 'overflow: auto');
    const item = div(scroller);
    await settle();
    place(scroller, { x: 0, y: 0, width: 100, height: 100 });
    place(item, { x: 0, y: 150, width: 100, height: 100 });
    const seen: string[] = [];
    const observer = new globals.IntersectionObserver(
      (entries: Dom[]) =>
        seen.push(...entries.map((entry) => `${entry.isIntersecting} ${entry.intersectionRatio}`)),
      { threshold: [0, 0.5] },
    );
    observer.observe(item);
    await nextFrame();
    const moveTo = async (y: number) => {
      place(item, { x: 0, y, width: 100, height: 100 });
      await scrolled(scroller, 0, 150 - y);
      await nextFrame();
    };
    await moveTo(50);
    await moveTo(60);
    await moveTo(55);
    // At the edge it is in sight, and has crossed nothing since 0.4.
    await moveTo(100);
    await moveTo(101);
    assert.deepEqual(seen, ['false 0', 'true 0.5', 'true 0.4', 'false 0'], 'none at 0.45');
  });

  it('hears a box scroll that started scrolling after the element was watched, and not one it left', async () => {
    const { app, place, div, make } = await page();
    const scroller = div();
    scroller.setAttribute('testID', 'later');
    const item = div(scroller);
    await settle();
    place(scroller, { x: 0, y: 0, width: 100, height: 100 });
    place(item, { x: 0, y: 150, width: 100, height: 100 });
    const seen: boolean[] = [];
    const observer = new globals.IntersectionObserver((entries: Dom[]) =>
      seen.push(...entries.map((entry) => entry.isIntersecting)),
    );
    observer.observe(item);
    await nextFrame();
    scroller.style.overflow = 'auto';
    await settle();
    await nextFrame();
    /** Native scrolls it, which commits nothing: the element moves in sight, or out. */
    const scrollTo = async (y: number) => {
      place(item, { x: 0, y, width: 100, height: 100 });
      app.fabric.emit(screen.getByTestId('later'), 'topScroll', { contentOffset: { x: 0, y } });
      await nextFrame();
    };
    await scrollTo(50);
    // In sight of the window, then cut off by the box once it scrolls, then scrolled into sight.
    assert.deepEqual(seen, [true, false, true]);
    // Moved out of it: its scrolls move the element no more.
    make('section').appendChild(item);
    await settle();
    await nextFrame();
    const count = seen.length;
    await scrollTo(900);
    assert.equal(seen.length, count, 'out of the window, and not looked at');
    observer.disconnect();
  });

  it('hears nothing of an element, nor of what it is in, once it is let go', async () => {
    const { div } = await page();
    const scroller = div(undefined, 'overflow: auto');
    const item = div(scroller);
    await settle();
    const count = (node: Dom, type: string) => node.listeners?.get(type)?.size ?? 0;
    const before = [count(scroller, 'topScroll'), count(item, 'topLayout')];
    const observer = new globals.IntersectionObserver(() => {});
    observer.observe(item);
    assert.deepEqual(
      [count(scroller, 'topScroll'), count(item, 'topLayout')],
      [before[0]! + 1, before[1]! + 1],
    );
    observer.unobserve(item);
    assert.deepEqual([count(scroller, 'topScroll'), count(item, 'topLayout')], before);
  });

  it('looks again after a commit, and at what is in sight of a root and its margin', async () => {
    const { place, div } = await page();
    const root = div();
    const item = div(root);
    await settle();
    place(root, { x: 0, y: 0, width: 100, height: 100 });
    place(item, { x: 0, y: 150, width: 100, height: 10 });
    const seen: Dom[] = [];
    const observer = new globals.IntersectionObserver((entries: Dom[]) => seen.push(...entries), {
      root,
      rootMargin: '10px',
    });
    observer.observe(item);
    await nextFrame();
    assert.equal(seen.at(-1).isIntersecting, false);
    assert.equal(sides(seen.at(-1).rootBounds), '-10 -10 110 110');
    // Moved by a style: nothing scrolled, and native has said nothing of it yet.
    place(item, { x: 0, y: 105, width: 100, height: 10 });
    item.style.marginTop = '5px';
    await settle();
    await nextFrame();
    assert.equal(seen.length, 2);
    assert.equal(seen[1].isIntersecting, true, 'inside the margin');
    assert.equal(sides(seen[1].intersectionRect), '0 105 100 110');
  });

  it('tells nothing of an element let go, and hands over what is queued when asked', async () => {
    const { place, div } = await page();
    const item = div();
    await settle();
    place(item, { x: 0, y: 0, width: 10, height: 10 });
    let calls = 0;
    const observer = new globals.IntersectionObserver(() => calls++);
    // Telling is a task of its own after the frame that looked, and which frame looks is not this
    // test's to say: one armed earlier can look before a frame asked for here. So telling is held
    // until the queue is taken, and the queue is taken whenever the look has been made.
    const realSetTimeout = globalThis.setTimeout;
    const held: (() => void)[] = [];
    globalThis.setTimeout = ((run: () => void, delay?: number, ...rest: unknown[]) => {
      if (delay !== undefined) return realSetTimeout(run, delay, ...rest);
      held.push(run);
      return 0;
    }) as typeof setTimeout;
    const taken: unknown[] = [];
    try {
      observer.observe(item);
      for (let tries = 0; !taken.length && tries < 500; tries++) {
        await new Promise((resolve) => realSetTimeout(resolve, 4));
        taken.push(...observer.takeRecords());
      }
    } finally {
      globalThis.setTimeout = realSetTimeout;
      for (const run of held) realSetTimeout(run);
    }
    assert.equal(taken.length, 1, 'looked at, and not yet told');
    await nextFrame();
    assert.equal(calls, 0, 'what was taken is not told');
    observer.unobserve(item);
    observer.observe(item);
    observer.disconnect();
    await nextFrame();
    assert.equal(calls, 0);
  });
});

/** Whether an app's commits are heard: its engine has a `commit` of its own while they are. */
const heard = (engine: Engine): boolean => Object.hasOwn(engine, 'commit');

describe('what watching costs', () => {
  it('hears no commit until an element is observed, and none once each is let go', async () => {
    const { engine, place, div } = await page();
    const box = div();
    await settle();
    place(box, { x: 0, y: 0, width: 10, height: 10 });
    box.getBoundingClientRect();
    void [box.offsetWidth, box.scrollTop, globals.matchMedia('(min-width: 1px)').matches];
    assert.equal(heard(engine), false, 'a read hears nothing after it');
    const resizes = new globals.ResizeObserver(() => {});
    const intersections = new globals.IntersectionObserver(() => {});
    resizes.observe(box);
    intersections.observe(box);
    assert.equal(heard(engine), true);
    resizes.unobserve(box);
    assert.equal(heard(engine), true, 'while one still watches');
    intersections.disconnect();
    assert.equal(heard(engine), false);
    resizes.observe(box);
    resizes.disconnect();
    assert.equal(heard(engine), false);
    await nextFrame();
  });

  it('hears no more of an app that went with its elements still observed', async () => {
    const { app, engine, div } = await page();
    const box = div();
    await settle();
    new globals.ResizeObserver(() => {}).observe(box);
    new globals.IntersectionObserver(() => {}).observe(box);
    assert.equal(heard(engine), true);
    app.unmount();
    assert.equal(heard(engine), false);
  });

  it('hears nothing of an app that did not ask, beside one that watches', async () => {
    const { div } = await page();
    const plain = await render(Page);
    const engine = plain.componentRef.injector.get(Engine);
    new globals.ResizeObserver(() => {}).observe(div());
    await settle();
    assert.equal(heard(engine), false);
    assert.equal(engine.commit, Engine.prototype.commit);
  });

  it('tells an observer of an element taken out, which only the commit after says', async () => {
    const { engine, place, div } = await page();
    const box = div();
    box.setAttribute('testID', 'gone');
    await settle();
    place(box, { x: 0, y: 0, width: 10, height: 10 });
    const seen: number[] = [];
    const observer = new globals.ResizeObserver((entries: Dom[]) =>
      seen.push(...entries.map((entry) => entry.contentRect.width)),
    );
    observer.observe(box);
    await nextFrame();
    // Taken out, which only the commit after says: native lays nothing out for it.
    box.remove();
    assert.equal(engine.commit(), true);
    await nextFrame();
    assert.deepEqual(seen, [10, 0]);
    observer.disconnect();
  });
});
