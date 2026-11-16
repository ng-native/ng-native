/**
 * Interaction observers: every tap, long press, scroll and swipe, as a plain event an app hands to
 * its analytics or monitoring tool.
 *
 * Such a tool cannot see a press here by wrapping React Native's own `Pressable`, which never
 * renders, so the press machine reports each press it fires, and a scroll view each drag.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { registerPlatformComponents, registerViewName } from '@ng-native/fabric';
import { cleanup, render, screen, type FakeFabric } from '@ng-native/testing';
import {
  SWIPE_VELOCITY,
  provideInteractionObserver,
  type InteractionEvent,
} from '@ng-native/components';
import { compileFixture } from './compile.ts';

type Fixture = {
  events: string[];
  scroll(): { nativeElement: { listeners?: Map<string, Set<unknown>> | null } };
};

let Component: Type<Fixture>;

before(async () => {
  const mod = await compileFixture('fixtures/interaction-observer.ts');
  Component = mod['InteractionObserverFixture'] as Type<Fixture>;
});

afterEach(cleanup);

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** Render with one observer per array given, each collecting what it hears. */
async function renderObserved(...heard: InteractionEvent[][]) {
  const rendered = await render(Component, {
    providers: heard.map((into) => provideInteractionObserver((event) => into.push(event))),
  });
  return { ...rendered, fabric: rendered.fabric, instance: rendered.instance };
}

const node = (id: string) => screen.getByTestId(id);

function tap(fabric: FakeFabric, id: string, at = { pageX: 30, pageY: 40 }) {
  const point = { ...at, locationX: 3, locationY: 4 };
  fabric.emit(node(id), 'topTouchStart', { touches: [point], changedTouches: [point], ...point });
  fabric.emit(node(id), 'topTouchEnd', { touches: [], changedTouches: [point], ...point });
}

describe('an interaction observer hears taps', () => {
  it('reports a tap with what the control says about itself', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric, instance } = await renderObserved(heard);
    fabric.emit(node('save'), 'topLayout', { layout: { x: 0, y: 0, width: 120, height: 48 } });
    tap(fabric, 'save');
    await settle();

    assert.deepEqual(instance.events, ['save']);
    assert.equal(heard.length, 1);
    const [event] = heard;
    const { timestamp, nativeTag, ...rest } = event!;
    assert.deepEqual(rest, {
      type: 'click',
      element: 'pressable',
      label: 'Save the draft',
      testID: 'save',
      nativeID: 'save-button',
      role: 'button',
      text: 'Save draft now',
      pageX: 30,
      pageY: 40,
      locationX: 3,
      locationY: 4,
      width: 120,
      height: 48,
      source: 'touch',
    });
    assert.equal(typeof timestamp, 'number');
    assert.equal(typeof nativeTag, 'number', 'the tag of the view the control committed');
  });

  it('reads the point from the lifted touch when the event itself carries none', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric } = await renderObserved(heard);
    const down = { pageX: 1, pageY: 2, locationX: 1, locationY: 2 };
    const up = { pageX: 50, pageY: 60, locationX: 5, locationY: 6 };
    fabric.emit(node('silent'), 'topTouchStart', { touches: [down], changedTouches: [down] });
    fabric.emit(node('silent'), 'topTouchEnd', { touches: [down], changedTouches: [up] });
    await settle();
    const { pageX, pageY, locationX, locationY } = heard[0]!;
    assert.deepEqual({ pageX, pageY, locationX, locationY }, up);
  });

  it('reports a tap on a control nothing listens to, which is a dead tap', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric } = await renderObserved(heard);
    tap(fabric, 'silent');
    await settle();
    assert.deepEqual(
      heard.map((event) => [event.type, event.testID, event.text]),
      [['click', 'silent', 'Nothing happens']],
    );
  });

  it('names the element each kind of touchable is', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric } = await renderObserved(heard);
    for (const id of ['fade', 'link', 'composed']) tap(fabric, id);
    await settle();
    assert.deepEqual(
      heard.map((event) => [event.element, event.testID, event.label]),
      [
        ['touchable-opacity', 'fade', 'Fade'],
        ['text', 'link', undefined],
        ['x-observed-button', 'composed', undefined],
      ],
    );
  });

  it('says nothing for a text that is not pressable, or a control that is disabled', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric, instance } = await renderObserved(heard);
    tap(fabric, 'label');
    tap(fabric, 'off');
    await settle();
    assert.deepEqual(heard, []);
    assert.deepEqual(instance.events, []);
  });

  it('says nothing for a press the finger dragged off', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric, instance } = await renderObserved(heard);
    const down = { pageX: 30, pageY: 40 };
    const away = { pageX: 30, pageY: 400 };
    fabric.emit(node('slow'), 'topTouchStart', {
      touches: [down],
      changedTouches: [down],
      ...down,
    });
    fabric.emit(node('slow'), 'topTouchMove', { touches: [away], changedTouches: [away], ...away });
    fabric.emit(node('slow'), 'topTouchEnd', { touches: [], changedTouches: [away], ...away });
    await settle();
    assert.deepEqual(instance.events, []);
    assert.deepEqual(heard, []);
  });

  it('says nothing for a press a scrolling list took away', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric, instance } = await renderObserved(heard);
    const down = { pageX: 30, pageY: 40 };
    fabric.emit(node('slow'), 'topTouchStart', {
      touches: [down],
      changedTouches: [down],
      ...down,
    });
    fabric.emit(node('list'), 'topScrollBeginDrag', { contentOffset: { x: 0, y: 0 } });
    fabric.emit(node('slow'), 'topTouchEnd', { touches: [], changedTouches: [down], ...down });
    await settle();
    assert.deepEqual(instance.events, []);
    assert.deepEqual(heard, []);
  });

  it('reports a long press as one, and not as a tap as well', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric, instance } = await renderObserved(heard);
    const down = { pageX: 30, pageY: 40 };
    fabric.emit(node('hold'), 'topTouchStart', {
      touches: [down],
      changedTouches: [down],
      ...down,
    });
    await settle(20);
    fabric.emit(node('hold'), 'topTouchEnd', { touches: [], changedTouches: [down], ...down });
    await settle();
    assert.deepEqual(instance.events, ['hold long']);
    assert.deepEqual(
      heard.map((event) => [event.type, event.testID]),
      [['long-press', 'hold']],
    );
  });

  it('reports a quick tap on a long-pressable control as a tap', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric } = await renderObserved(heard);
    tap(fabric, 'hold');
    await settle();
    assert.deepEqual(
      heard.map((event) => [event.type, event.testID]),
      [['click', 'hold']],
    );
  });

  it('collapses the whitespace in a bound text', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric } = await renderObserved(heard);
    tap(fabric, 'spaced');
    await settle();
    assert.equal(heard[0]?.text, 'Two lines');
  });

  it('cuts a long text to the first hundred characters', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric } = await renderObserved(heard);
    tap(fabric, 'long-text');
    await settle();
    assert.equal(heard[0]?.text, 'word '.repeat(20).slice(0, 100));
  });

  it('hands every observer the event, after the control has run its own handler', async () => {
    const first: InteractionEvent[] = [];
    const second: InteractionEvent[] = [];
    const order: string[] = [];
    const rendered = await render(Component, {
      providers: [
        provideInteractionObserver((event) => {
          order.push(`first saw ${[...rendered.instance.events].join()}`);
          first.push(event);
        }),
        provideInteractionObserver((event) => second.push(event)),
      ],
    });
    tap(rendered.fabric, 'save');
    await settle();
    assert.deepEqual(order, ['first saw save']);
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(first[0], second[0], 'one event, shared');
  });

  it('keeps going past an observer that throws, and warns about it once', async () => {
    const heard: InteractionEvent[] = [];
    const warn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      const rendered = await render(Component, {
        providers: [
          provideInteractionObserver(() => {
            throw new Error('broken tool');
          }),
          provideInteractionObserver((event) => heard.push(event)),
        ],
      });
      tap(rendered.fabric, 'save');
      tap(rendered.fabric, 'save');
      await settle();
      assert.deepEqual(rendered.instance.events, ['save', 'save']);
      assert.equal(heard.length, 2);
      assert.equal(warnings.length, 1);
      assert.match(String(warnings[0]?.[0]), /interaction observer threw/);
    } finally {
      console.warn = warn;
    }
  });

  it('builds nothing when no observer is registered', async () => {
    const { fabric, instance } = await render(Component);
    tap(fabric, 'save');
    await settle();
    assert.deepEqual(instance.events, ['save']);
    assert.equal(
      instance.scroll().nativeElement.listeners?.has('topScrollEndDrag') ?? false,
      false,
      'a scroll view with no observer listens for no drag',
    );
  });
});

describe('an interaction observer names the component a control belongs to', () => {
  async function componentOf(id: string): Promise<InteractionEvent> {
    const heard: InteractionEvent[] = [];
    const { fabric } = await renderObserved(heard);
    tap(fabric, id);
    await settle();
    assert.equal(heard.length, 1);
    return heard[0]!;
  }

  it('reports the component whose template holds the pressable', async () => {
    const event = await componentOf('card-action');
    assert.equal(event.element, 'pressable');
    assert.equal(event.component, 'x-observed-card');
  });

  it('passes over an element that only a directive matches', async () => {
    assert.equal((await componentOf('in-region')).component, 'x-observed-card');
  });

  it('reports the innermost component, not the one around it', async () => {
    assert.equal((await componentOf('wrapped')).component, 'x-wrapped-button');
  });

  it('reports the component a pressable is projected into', async () => {
    assert.equal((await componentOf('projected')).component, 'x-observed-card');
  });

  it('reports no component for a pressable in the app component itself', async () => {
    assert.equal('component' in (await componentOf('save')), false);
  });

  it('reports a component composing the press machine by its own name, with no component', async () => {
    const event = await componentOf('composed');
    assert.equal(event.element, 'x-observed-button');
    assert.equal('component' in event, false);
  });

  it('reports the component around a component composing the press machine', async () => {
    const event = await componentOf('composed-in-card');
    assert.equal(event.element, 'x-observed-button');
    assert.equal(event.component, 'x-observed-card');
  });

  it('names the component a scroll view is in as well', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric } = await renderObserved(heard);
    fabric.emit(node('card-scroll'), 'topScrollBeginDrag', { contentOffset: { x: 0, y: 0 } });
    fabric.emit(node('card-scroll'), 'topScrollEndDrag', { contentOffset: { x: 0, y: 80 } });
    await settle();
    assert.deepEqual(
      heard.map((event) => [event.element, event.component]),
      [['scroll-view', 'x-observed-card']],
    );
  });
});

describe('an interaction observer hears clicks on Android', () => {
  before(() => registerPlatformComponents('android'));
  after(() => {
    registerPlatformComponents('ios');
    registerViewName('switch', 'Switch');
    registerViewName('text-input', 'TextInput');
    registerViewName('activity-indicator', 'ActivityIndicatorView');
    registerViewName('refresh-control', 'PullToRefreshView');
    registerViewName('safe-area-view', 'SafeAreaView');
    registerViewName('input-accessory-view', 'InputAccessoryView');
  });

  it('reports a press from a keyboard or TalkBack, with no touch', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric, instance } = await renderObserved(heard);
    fabric.emit(node('save'), 'topClick', {});
    await settle();
    assert.deepEqual(instance.events, ['save']);
    assert.equal(heard.length, 1);
    assert.equal(heard[0]?.source, 'click');
    assert.equal(heard[0]?.type, 'click');
    assert.equal('pageX' in heard[0]!, false, 'no touch, so no point');
  });

  it('says nothing for a click on a disabled control', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric } = await renderObserved(heard);
    fabric.emit(node('off'), 'topClick', {});
    await settle();
    assert.deepEqual(heard, []);
  });

  it('says nothing for a click a touch already pressed through', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric } = await renderObserved(heard);
    fabric.emit(node('save'), 'topClick', { pointerType: 'touch' });
    await settle();
    assert.deepEqual(heard, []);
  });
});

describe('an interaction observer hears scrolls and swipes', () => {
  const drag = (
    fabric: FakeFabric,
    id: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    velocity = { x: 0, y: 0 },
  ) => {
    fabric.emit(node(id), 'topScrollBeginDrag', { contentOffset: from });
    fabric.emit(node(id), 'topScrollEndDrag', { contentOffset: to, velocity });
  };

  it('reports a drag as a scroll, the way the content moved', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric } = await renderObserved(heard);
    drag(fabric, 'list', { x: 0, y: 0 }, { x: 0, y: 300 });
    drag(fabric, 'list', { x: 0, y: 300 }, { x: 0, y: 100 });
    drag(fabric, 'list', { x: 0, y: 0 }, { x: 80, y: 10 });
    drag(fabric, 'list', { x: 80, y: 0 }, { x: 0, y: 5 });
    // A diagonal drag goes by its vertical axis, the one a list most often scrolls along.
    drag(fabric, 'list', { x: 0, y: 0 }, { x: 30, y: 30 });
    await settle();
    assert.deepEqual(
      heard.map((event) => [event.type, event.element, event.testID, event.direction]),
      [
        ['scroll', 'scroll-view', 'list', 'down'],
        ['scroll', 'scroll-view', 'list', 'up'],
        ['scroll', 'scroll-view', 'list', 'right'],
        ['scroll', 'scroll-view', 'list', 'left'],
        ['scroll', 'scroll-view', 'list', 'down'],
      ],
    );
    assert.equal(heard[0]?.source, 'touch');
    assert.equal(typeof heard[0]?.nativeTag, 'number');
  });

  it('reports a flick as a swipe', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric } = await renderObserved(heard);
    drag(fabric, 'list', { x: 0, y: 0 }, { x: 0, y: 40 }, { x: 0, y: SWIPE_VELOCITY });
    drag(fabric, 'list', { x: 0, y: 0 }, { x: 0, y: 40 }, { x: 0, y: -SWIPE_VELOCITY * 0.9 });
    await settle();
    assert.deepEqual(
      heard.map((event) => event.type),
      ['swipe', 'scroll'],
    );
  });

  it('reports a drag in a virtual list', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric } = await renderObserved(heard);
    drag(fabric, 'rows', { x: 0, y: 0 }, { x: 0, y: 20 });
    await settle();
    assert.deepEqual(
      heard.map((event) => [event.type, event.element, event.direction]),
      [['scroll', 'virtual-list', 'down']],
    );
  });

  it('says nothing for a drag that went nowhere, or a scroll with no drag', async () => {
    const heard: InteractionEvent[] = [];
    const { fabric } = await renderObserved(heard);
    drag(fabric, 'list', { x: 0, y: 50 }, { x: 0, y: 50 });
    fabric.emit(node('list'), 'topScroll', { contentOffset: { x: 0, y: 200 } });
    fabric.emit(node('list'), 'topMomentumScrollEnd', { contentOffset: { x: 0, y: 200 } });
    fabric.emit(node('list'), 'topScrollEndDrag', { contentOffset: { x: 0, y: 300 } });
    await settle();
    assert.deepEqual(heard, []);
  });
});
