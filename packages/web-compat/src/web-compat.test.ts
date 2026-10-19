/**
 * `@ng-native/web-compat`: engine nodes answering to the DOM members a component library written
 * for the browser calls, each one going through the engine's own mutation API.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, ElementRef, Renderer2, inject, signal } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { Engine } from '@ng-native/fabric';
import { cleanup, fireEvent, render, screen, settle, userEvent } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

afterEach(cleanup);

/** What a library sees of an element: loosely typed, as its own code would be against the DOM. */
type Dom = any;

@Component({
  selector: 'x-card',
  imports: [Text, View],
  template: `
    <view class="card" testID="card" data-kind="a">
      <view class="row first"><text>One</text></view>
      <view class="row" id="second"><text>Two</text></view>
    </view>
  `,
})
class Card {
  readonly host: Dom = inject(ElementRef).nativeElement;
  readonly document: Dom = inject(DOCUMENT);
  readonly renderer = inject(Renderer2);
}

@Component({
  selector: 'x-clicks',
  imports: [Text, View],
  template: `<view testID="box" (click)="clicks.set(clicks() + 1)"
    ><text>{{ clicks() }}</text></view
  >`,
})
class Clicks {
  readonly clicks = signal(0);
}

@Component({
  selector: 'x-heard',
  imports: [View],
  template: `<view testID="outer" (click)="heard.push('outer')" (picked)="heard.push('picked')"
    ><view testID="inner" class="inner" (click)="heard.push('inner')"></view
  ></view>`,
})
class Heard {
  readonly host: Dom = inject(ElementRef).nativeElement;
  readonly document: Dom = inject(DOCUMENT);
  readonly heard: string[] = [];
}

@Component({
  selector: 'x-drag',
  template: `
    <div
      testID="track"
      (pointerdown)="see($event)"
      (pointermove)="see($event)"
      (pointerup)="see($event)"
      (pointercancel)="see($event)"
      (click)="click($event)"
    >
      <div testID="range"></div>
    </div>
  `,
})
class Drag {
  readonly seen: string[] = [];
  readonly targets: unknown[] = [];
  clicked?: MouseEvent;
  click(event: MouseEvent): void {
    this.clicked = event;
    this.seen.push('click');
  }
  see(event: PointerEvent): void {
    const target = event.target as unknown as Element & { props: Record<string, unknown> };
    this.targets.push(target.props['testID']);
    target.setPointerCapture(event.pointerId);
    const captured = target.hasPointerCapture(event.pointerId) ? 'captured' : 'free';
    this.seen.push(`${event.type} ${event.clientX},${event.clientY} ${captured}`);
  }
}

@Component({
  selector: 'x-pressed',
  template: `<div testID="area" (click)="clicks.set(clicks() + 1)"></div>`,
})
class Pressed {
  readonly clicks = signal(0);
}

@Component({
  template: '<div testID="list"><div testID="item">One</div><div testID="other">Two</div></div>',
})
class Dragged {}

@Component({
  selector: 'x-labelled',
  template: `<span testID="label" [textContent]="label()"></span>`,
})
class Labelled {
  readonly label = signal<string | null>('Apple');
}

const globals = globalThis as Dom;

const mount = async () => {
  const app = await render(Card, { providers: [provideWebCompat()] });
  const host = app.instance.host;
  const card = host.firstElementChild as Dom;
  return { app, host, card };
};

/** A finger down on, or lifted from, a node: what Fabric sends for either. */
const touch = (testID: string, phase: 'Start' | 'End') => {
  const node = screen.getByTestId(testID);
  const point = { identifier: 0, target: node.reactTag, pageX: 30, pageY: 20 };
  return fireEvent(node, `topTouch${phase}`, {
    ...point,
    touches: phase === 'Start' ? [point] : [],
    changedTouches: [point],
  });
};

/** A finger at a place on the screen, down or lifted. */
const finger = (pageX: number, pageY: number, down = true) => {
  const point = { identifier: 0, pageX, pageY, locationX: 0, locationY: 0 };
  return { ...point, touches: down ? [point] : [], changedTouches: [point] };
};

describe('@ng-native/web-compat nodes', () => {
  it('reads and writes attributes as props, and class as classes', async () => {
    const { card } = await mount();
    assert.equal(card.getAttribute('data-kind'), 'a');
    assert.equal(card.getAttribute('title'), null);
    assert.equal(card.hasAttribute('data-kind'), true);
    assert.equal(card.getAttribute('class'), 'card');

    card.setAttribute('testID', 'renamed');
    card.setAttribute('aria-hidden', 'false');
    card.removeAttribute('data-kind');
    assert.ok(await screen.findByTestId('renamed'), 'committed through the engine');
    assert.equal(card.props['aria-hidden'], false, 'a typed prop is not left a string');
    assert.equal(card.getAttribute('aria-hidden'), 'false', 'and reads back as written');
    card.setAttribute('aria-expanded', 'yes');
    assert.equal(card.props['aria-expanded'], true);
    assert.equal(card.getAttribute('aria-expanded'), 'yes', 'the words, not the prop they are');
    assert.equal(card.hasAttribute('data-kind'), false);

    card.classList.add('on');
    assert.equal(card.classList.contains('on'), true);
    assert.equal(card.className, 'card on');
    assert.equal(card.classList.toggle('on'), false);
    card.className = 'a b';
    assert.deepEqual([...card.classList], ['a', 'b']);
    assert.equal(card.toggleAttribute('hidden-by-me'), true);
    assert.equal(card.getAttribute('hidden-by-me'), '');
    assert.equal(card.toggleAttribute('hidden-by-me'), false);
    assert.equal(card.hasAttribute('hidden-by-me'), false);
  });

  it('sets an attribute as a template sets it: an id as the native id, a style as declarations', async () => {
    const { app, card } = await mount();
    card.setAttribute('id', 'main');
    assert.equal(card.props['nativeID'], 'main');
    assert.equal(card.id, 'main');
    assert.equal(app.instance.document.getElementById('main'), card);
    // A template's own id is the same native id, which the document finds it by.
    assert.equal(app.instance.document.getElementById('second'), card.lastElementChild);
    card.setAttribute('style', 'opacity: 0.5');
    assert.equal(card.props['style'].opacity, 0.5);
    assert.equal(card.getAttribute('style'), 'opacity: 0.5');
    card.removeAttribute('style');
    assert.equal(card.props['style']?.opacity, undefined);
    assert.equal(card.hasAttribute('style'), false);
  });

  it('says what kind of node one is, and what it is called', async () => {
    const { app, card } = await mount();
    const document = app.instance.document;
    assert.equal(card.nodeType, Node.ELEMENT_NODE);
    assert.equal(card.ELEMENT_NODE, 1);
    assert.equal(card.nodeName, 'VIEW');
    assert.equal(card.localName, 'view');
    const text = document.createTextNode('words');
    assert.equal(text.nodeType, Node.TEXT_NODE);
    assert.equal(text.nodeName, '#text');
    assert.equal(text.nodeValue, 'words');
    const comment = document.createComment('note');
    assert.equal(comment.nodeType, Node.COMMENT_NODE);
    assert.equal(comment.nodeName, '#comment');
    assert.equal(comment.textContent, 'note');
    assert.equal(card instanceof HTMLElement, true);
    assert.equal(text instanceof HTMLElement, false);
  });

  it('walks the tree around a node', async () => {
    const { app, host, card } = await mount();
    const [first, second] = card.childList as Dom[];
    assert.equal(card.parentNode, host);
    assert.equal(card.firstChild, first);
    assert.equal(card.lastChild, second);
    assert.equal(first.nextSibling, second);
    assert.equal(second.previousSibling, first);
    assert.equal(second.nextSibling, null);
    assert.equal(first.nextElementSibling, second);
    assert.equal(second.previousElementSibling, first);
    assert.equal(first.parentElement, card);
    assert.equal(card.contains(first.firstChild), true);
    assert.equal(first.contains(second), false);
    assert.equal(card.textContent, 'OneTwo');
    assert.equal(card.ownerDocument, app.instance.document);
    // The root is in the document, which is where a walk up ends.
    const root = app.instance.document.documentElement;
    assert.equal(root.parentNode, app.instance.document);
    assert.equal(root.parentElement, null);
  });

  it('moves and removes nodes through the engine', async () => {
    const { card } = await mount();
    const [first, second] = card.childList as Dom[];
    card.appendChild(first);
    assert.deepEqual(card.childList, [second, first]);
    card.insertBefore(first, second);
    assert.equal(card.firstElementChild, first);
    second.remove();
    assert.equal(second.isConnected, false);
    await settle();
    assert.equal(screen.queryByText('Two'), null, 'and the commit follows');
    assert.equal(card.removeChild(first), first);
    await settle();
    assert.equal(screen.queryByText('One'), null);
  });

  it('refuses a node put inside itself, and one that is no child of it', async () => {
    const { card } = await mount();
    const [first, second] = card.childList as Dom[];
    assert.throws(() => first.appendChild(card), { name: 'HierarchyRequestError' });
    assert.throws(() => first.removeChild(second), { name: 'NotFoundError' });
    assert.throws(() => first.insertBefore(card.ownerDocument.createElement('div'), second), {
      name: 'NotFoundError',
    });
    assert.throws(() => card.appendChild({}), TypeError);
    assert.deepEqual(card.childList, [first, second], 'and nothing moved');
  });

  it('replaces what an element holds with its text, and the words of a text', async () => {
    const { card } = await mount();
    const [first] = card.childList as Dom[];
    const words = first.firstChild.firstChild;
    words.textContent = 'Uno';
    await settle();
    assert.ok(screen.getByText('Uno'));
    card.textContent = 'Plain';
    assert.equal(card.childList.length, 1);
    assert.equal(card.textContent, 'Plain');
    card.textContent = null;
    assert.equal(card.childList.length, 0);
  });

  it('adds and removes a listener', async () => {
    const { card } = await mount();
    let heard = 0;
    const listener = () => heard++;
    card.addEventListener('layout', listener);
    await fireEvent.layout(screen.getByTestId('card'), { width: 1, height: 1 });
    assert.equal(heard, 1);
    card.removeEventListener('layout', listener);
    await fireEvent.layout(screen.getByTestId('card'), { width: 2, height: 2 });
    assert.equal(heard, 1);
  });

  it('hears a press as the click an element listens for itself, until the listener is taken off', async () => {
    // A `@defer` trigger and a library's own listener both add one this way.
    const { card } = await mount();
    let heard = 0;
    const listener = () => void heard++;
    card.addEventListener('click', listener);
    await settle();
    await userEvent.press(screen.getByTestId('card'));
    assert.equal(heard, 1);
    card.removeEventListener('click', listener);
    await userEvent.press(screen.getByTestId('card'));
    assert.equal(heard, 1);
  });
});

describe('@ng-native/web-compat document and window', () => {
  it('creates engine nodes, and draws what is appended to the body over the app', async () => {
    const { app, host } = await mount();
    const document = app.instance.document;
    assert.equal(globals.document, document);
    assert.equal(host.ownerDocument, document);

    const overlay = document.createElement('DIV');
    assert.equal(overlay.tag, 'div');
    overlay.setAttribute('testID', 'overlay');
    document.body.appendChild(overlay);
    await settle();
    assert.ok(screen.getByTestId('overlay'));
    assert.equal(document.body.props.pointerEvents, 'box-none');
    assert.equal(document.body.contains(host), true, 'the whole page is in the body');
    assert.equal(document.activeElement, document.body, 'with no field focused');
  });

  it('has its body in the tree from the start, over the app, and never moves it', async () => {
    const { app } = await mount();
    const document = app.instance.document;
    const root = document.documentElement;
    assert.equal(document.body.isConnected, true);
    assert.ok(Number(document.body.props.style.zIndex) > 0, 'over the app by its z-index');
    const at = root.childList.indexOf(document.body);
    document.body.appendChild(document.createElement('div'));
    document.body.appendChild(document.createElement('div'));
    await settle();
    assert.equal(root.childList.indexOf(document.body), at);
    assert.equal(root.childList.filter((child: unknown) => child === document.body).length, 1);
  });

  it('names its root html and its body body, where a library stops walking up', async () => {
    // Floating UI climbs parents until one is named html or body, and never stops otherwise.
    const { app } = await mount();
    const document = app.instance.document;
    assert.equal(document.documentElement.nodeName, 'HTML');
    assert.equal(document.body.nodeName, 'BODY');
    assert.equal(document.body.tagName, 'BODY', 'as a browser names an element');
    assert.equal(document.createElement('div').tagName, 'DIV');
    assert.equal(document.createTextNode('x').tagName, undefined);
    assert.equal(document.body.localName, 'body');
    assert.equal(document.createElement('div').nodeName, 'DIV');
    assert.equal(document.nodeType, Node.DOCUMENT_NODE);
    assert.equal(document.nodeName, '#document');
  });

  it('does not hand a document listener the press it was added during', async () => {
    const { app, card } = await mount();
    const document = app.instance.document;
    let later = 0;
    app.instance.renderer.listen(card, 'click', () =>
      document.addEventListener('click', () => later++),
    );
    await userEvent.press(screen.getByTestId('card'));
    assert.equal(later, 0, 'the press that added it');
    await userEvent.press(screen.getByTestId('card'));
    assert.equal(later, 1, 'the next one');
  });

  it('tells the document of the release of a press that added the listener for it', async () => {
    // A stepper repeats while its button is held: its pointerdown starts the repeating and adds
    // a pointerup listener on the document, which is all that stops it.
    const { app, card } = await mount();
    const document = app.instance.document;
    const heard: string[] = [];
    card.addEventListener('pointerdown', () => {
      heard.push('down');
      const up = () => {
        heard.push('up');
        document.removeEventListener('pointerup', up);
      };
      document.addEventListener('pointerup', up);
    });
    // The touch and its end with nothing run between them, as a device sends a quick tap: the
    // release is still not the event the listener was added during.
    fireEvent.press(screen.getByTestId('card'));
    assert.deepEqual(heard, ['down', 'up']);
    fireEvent.press(screen.getByTestId('card'));
    assert.deepEqual(heard, ['down', 'up', 'down', 'up']);
  });

  it('tells a box of a pointer that comes down on an element in it that listens too', async () => {
    // A colour area and the thumb in it: the area's own pointerdown starts the drag, and the
    // finger comes down on the thumb, which has listeners of its own. A browser tells both.
    const { card } = await mount();
    const first = card.firstElementChild as Dom;
    const heard: unknown[] = [];
    first.addEventListener('pointerdown', () => heard.push('thumb'));
    card.addEventListener('pointerdown', (event: Dom) =>
      heard.push(['area', first.contains(event.target), event.currentTarget === card]),
    );
    fireEvent.press(screen.getByText('One'));
    assert.deepEqual(heard, ['thumb', ['area', true, true]]);
    // Until the element stops it going further.
    heard.length = 0;
    first.addEventListener('pointerdown', (event: Dom) => event.stopPropagation());
    fireEvent.press(screen.getByText('One'));
    assert.deepEqual(heard, ['thumb']);
  });

  it('tells the document of a pointer by the id the element it is on was told', async () => {
    // A slider's thumb: its pointerdown keeps the pointer's id, and a move the document hears
    // is the thumb's only where it has that id. Without one no thumb is ever dragged.
    const { app, card } = await mount();
    const document = app.instance.document;
    const ids: unknown[] = [];
    card.addEventListener('pointerdown', (down: Dom) => {
      ids.push(['down', down.pointerId, down.pointerType]);
      const up = (event: Dom) => {
        ids.push(['up', event.pointerId, event.pointerType, event.button]);
        document.removeEventListener('pointerup', up);
      };
      document.addEventListener('pointerup', up);
    });
    fireEvent.press(screen.getByTestId('card'));
    assert.deepEqual(ids, [
      ['down', 0, 'touch'],
      ['up', 0, 'touch', 0],
    ]);
  });

  it('hears a press anywhere from the document, the body and the renderer, until each is removed', async () => {
    const { app, card } = await mount();
    const document = app.instance.document;
    const heard: [string, unknown][] = [];
    const onDocument = (event: Dom) => void heard.push(['document', event.target]);
    const onBody = (event: Dom) => void heard.push(['body', event.composedPath().includes(card)]);
    document.addEventListener('click', onDocument);
    document.body.addEventListener('pointerdown', onBody);
    const stop = app.instance.renderer.listen(
      'document',
      'click',
      () => void heard.push(['renderer', 0]),
    );
    const stopBody = app.instance.renderer.listen(
      document.body,
      'click',
      () => void heard.push(['body node', 0]),
    );
    // A key has no touch behind it, and nothing to listen with.
    document.addEventListener('keydown', onDocument);

    await settle();
    await userEvent.press(screen.getByTestId('card'));
    assert.deepEqual(heard, [
      ['body', true],
      ['document', card],
      ['renderer', 0],
      ['body node', 0],
    ]);

    document.removeEventListener('click', onDocument);
    document.body.removeEventListener('pointerdown', onBody);
    stop();
    stopBody();
    await userEvent.press(screen.getByTestId('card'));
    assert.equal(heard.length, 4);
  });

  it('tells the document of a scroll in any scroll view, and of no click for a drag', async () => {
    await render(Pressed, { providers: [provideWebCompat()] });
    let clicks = 0;
    globals.document.addEventListener('click', () => clicks++);
    await settle();
    const area = screen.getByTestId('area');
    await fireEvent(area, 'touchStart', finger(40, 60));
    await fireEvent(area, 'touchMove', finger(40, 110));
    await fireEvent(area, 'touchEnd', finger(40, 110, false));
    assert.equal(clicks, 0, 'a finger that went that far was dragging');
    // A finger is never quite still: a few points is a press all the same.
    await fireEvent(area, 'touchStart', finger(40, 60));
    await fireEvent(area, 'touchEnd', finger(43, 64, false));
    assert.equal(clicks, 1);
  });

  it('has the size of the window, and tells a resize listener when it changes', async () => {
    const app = await render(Card, {
      providers: [provideWebCompat()],
      conditions: { width: 390, height: 844, colorScheme: 'light' },
    });
    assert.equal(globals.innerWidth, 390);
    assert.equal(globals.innerHeight, 844);
    assert.equal(globals.scrollY, 0);
    let told = 0;
    app.componentRef.injector.get(Renderer2).listen('window', 'resize', () => void told++);
    app.componentRef.injector
      .get(Engine)
      .updateConditions({ width: 844, height: 390, colorScheme: 'light' });
    assert.equal(told, 1);
    assert.equal(globals.innerHeight, 390);
  });

  it('takes the window itself as somewhere to listen, as it takes its name', async () => {
    // A library that holds `window` hands the renderer the object, where a template says
    // `window:resize`. It is anywhere in the app either way, and no element to listen on.
    const app = await render(Card, {
      providers: [provideWebCompat()],
      conditions: { width: 390, height: 844, colorScheme: 'light' },
    });
    const renderer = app.componentRef.injector.get(Renderer2);
    let told = 0;
    const stops = [
      renderer.listen(globalThis, 'scroll', () => void told++),
      renderer.listen(globalThis, 'resize', () => void told++),
    ];
    app.componentRef.injector
      .get(Engine)
      .updateConditions({ width: 844, height: 390, colorScheme: 'light' });
    assert.equal(told, 1);
    for (const stop of stops) stop();
  });

  it('says it takes touches, and is the top window in no frame', async () => {
    await mount();
    assert.equal('ontouchstart' in globalThis, true);
    assert.equal(globals.window, globalThis);
    assert.equal(globals.top, globalThis);
    assert.equal(globals.parent, globalThis);
    assert.equal(globals.frameElement, null);
  });

  it('answers for an element over an HTMLElement the runtime has of its own, and puts it back', async () => {
    // React Native has one, for its own views: left in place, no element of the engine's is one,
    // and Material draws no ripple for a touch that landed on nothing it knows.
    class Native {}
    const target = globalThis as unknown as { HTMLElement?: unknown };
    target.HTMLElement = Native;
    try {
      const { card } = await mount();
      assert.equal(card instanceof HTMLElement, true);
      assert.equal(new Native() instanceof HTMLElement, true);
      assert.equal({} instanceof HTMLElement, false);
      cleanup();
      assert.equal(target.HTMLElement, Native);
    } finally {
      delete target.HTMLElement;
    }
  });
});

describe('@ng-native/web-compat clicks and touches', () => {
  it('delivers a click from a press, and only where the package was asked for', async () => {
    await render(Clicks, { providers: [provideWebCompat()] });
    await userEvent.press(screen.getByTestId('box'));
    assert.ok(screen.getByText('1'));
    cleanup();

    await render(Clicks);
    await userEvent.press(screen.getByTestId('box'));
    assert.ok(screen.getByText('0'));
  });

  it('runs every click listener a node has, until each is removed', async () => {
    const { app, card } = await mount();
    const heard: string[] = [];
    const stopFirst = app.instance.renderer.listen(card, 'click', () => void heard.push('first'));
    const stopSecond = app.instance.renderer.listen(card, 'click', () => void heard.push('second'));
    await userEvent.press(screen.getByTestId('card'));
    assert.deepEqual(heard, ['first', 'second']);
    stopFirst();
    await userEvent.press(screen.getByTestId('card'));
    assert.deepEqual(heard, ['first', 'second', 'second']);
    stopSecond();
    await userEvent.press(screen.getByTestId('card'));
    assert.equal(heard.length, 3);
  });

  it('sends a click on up the tree, to each box over it that listens, until one stops it', async () => {
    const { app, card } = await mount();
    const { renderer } = app.instance;
    const inner = renderer.createElement('div');
    renderer.setAttribute(inner, 'testID', 'inner');
    renderer.appendChild(card, inner);
    const heard: string[] = [];
    let stop = false;
    renderer.listen(inner, 'click', (event: Event) => {
      heard.push('inner');
      if (stop) event.stopPropagation();
    });
    // A menu closes by the click on one of its items reaching the panel around them.
    renderer.listen(card, 'click', (event: Event) => {
      heard.push(`card from ${event.target === inner} at ${event.currentTarget === card}`);
    });
    await settle();
    await userEvent.press(screen.getByTestId('inner'));
    assert.deepEqual(heard, ['inner', 'card from true at true']);
    stop = true;
    await userEvent.press(screen.getByTestId('inner'));
    assert.deepEqual(heard, ['inner', 'card from true at true', 'inner']);
  });

  it('delivers no click to a disabled element, as a browser does not', async () => {
    const { app, card } = await mount();
    let heard = 0;
    app.instance.renderer.listen(card, 'click', () => void heard++);
    card.setAttribute('disabled', '');
    await userEvent.press(screen.getByTestId('card'));
    assert.equal(heard, 0);
    card.removeAttribute('disabled');
    await userEvent.press(screen.getByTestId('card'));
    assert.equal(heard, 1);
  });

  it('delivers a touch as pointer events at the finger, captured until it lifts', async () => {
    const app = await render(Drag, { providers: [provideWebCompat()] });
    const track = screen.getByTestId('track');
    await fireEvent(track, 'touchStart', finger(10, 5));
    await fireEvent(track, 'touchMove', finger(60, 5));
    await fireEvent(track, 'touchMove', finger(90, 8));
    const node = app.componentRef.location.nativeElement.childList[0];
    assert.equal(node.hasPointerCapture(0), true);
    await fireEvent(track, 'touchEnd', finger(90, 8, false));
    assert.deepEqual(app.instance.seen, [
      'pointerdown 10,5 captured',
      'pointermove 60,5 captured',
      'pointermove 90,8 captured',
      'pointerup 90,8 captured',
      // And no click: a finger that went that far was dragging.
    ]);
    assert.equal(node.hasPointerCapture(0), false, 'and let go once it has');
  });

  it('delivers a click as one of the primary button with no key held, at the finger', async () => {
    // What a router's link reads before it navigates: any other button or a held key is the
    // browser's to handle, a new tab or a download.
    const app = await render(Drag, { providers: [provideWebCompat()] });
    const track = screen.getByTestId('track');
    await fireEvent(track, 'touchStart', finger(10, 5));
    await fireEvent(track, 'touchEnd', finger(12, 6, false));
    const { button, ctrlKey, shiftKey, altKey, metaKey, clientX, clientY } = app.instance.clicked!;
    assert.deepEqual(
      { button, ctrlKey, shiftKey, altKey, metaKey, clientX, clientY },
      {
        button: 0,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        clientX: 12,
        clientY: 6,
      },
    );
  });

  it('names the element the touch landed on as the target', async () => {
    const app = await render(Drag, { providers: [provideWebCompat()] });
    await fireEvent(screen.getByTestId('range'), 'touchStart', finger(1, 1));
    await fireEvent(screen.getByTestId('range'), 'touchEnd', finger(1, 1, false));
    assert.deepEqual(app.instance.targets, ['range', 'range']);
    assert.equal(app.instance.seen[0], 'pointerdown 1,1 captured');
  });

  it('delivers them to a listener a library adds to the element itself, until it is removed', async () => {
    const app = await render(Drag, { providers: [provideWebCompat()] });
    const node = app.componentRef.location.nativeElement.childList[0];
    const heard: string[] = [];
    const listener = (event: PointerEvent) => heard.push(`${event.type} ${event.clientX}`);
    node.addEventListener('pointermove', listener);
    const track = screen.getByTestId('track');
    await fireEvent(track, 'touchStart', finger(10, 5));
    await fireEvent(track, 'touchMove', finger(60, 5));
    node.removeEventListener('pointermove', listener);
    await fireEvent(track, 'touchMove', finger(70, 5));
    await fireEvent(track, 'touchEnd', finger(70, 5, false));
    assert.deepEqual(heard, ['pointermove 60']);
  });

  it('hears a finger put down on an element and lifted, through the renderer', async () => {
    // Material's tooltip listens this way for a finger held on its control.
    const { app, card } = await mount();
    const heard: string[] = [];
    const stops = ['touchstart', 'touchend'].map((type) =>
      app.instance.renderer.listen(card, type, (event: Dom) => {
        heard.push(`${event.type} ${event.target === card} ${event.touches.length}`);
      }),
    );
    await touch('card', 'Start');
    await touch('card', 'End');
    assert.deepEqual(heard, ['touchstart true 1', 'touchend true 0']);
    for (const stop of stops) stop();
    await touch('card', 'Start');
    assert.equal(heard.length, 2);
  });

  it('hears a finger lifted from an element, by a listener that is an object', async () => {
    const { card } = await mount();
    const lifted: string[] = [];
    const listener = { handleEvent: () => void lifted.push('up') };
    card.addEventListener('touchend', listener as never);
    await touch('card', 'Start');
    await touch('card', 'End');
    assert.deepEqual(lifted, ['up']);
    card.removeEventListener('touchend', listener as never);
    await touch('card', 'Start');
    await touch('card', 'End');
    assert.deepEqual(lifted, ['up']);
  });

  it('names what a touch landed on as the target, for a listener on a box around it', async () => {
    // A row dragged by its handle listens on the row and asks whether the touch is on the handle.
    const app = await render(Dragged, { providers: [provideWebCompat()] });
    const list = app.componentRef.location.nativeElement.firstElementChild as Dom;
    const item = list.firstChild;
    const heard: unknown[] = [];
    const hear = (event: { target: unknown; currentTarget: unknown }) =>
      heard.push([event.target === item, event.currentTarget === list]);
    list.addEventListener('touchstart', hear);
    await settle();
    const node = screen.getByTestId('item');
    const point = { identifier: 0, target: node.reactTag, pageX: 30, pageY: 20 };
    await fireEvent(node, 'topTouchStart', { ...point, touches: [point], changedTouches: [point] });
    assert.deepEqual(heard, [[true, true]]);
  });

  it('draws the text bound to textContent, and follows it', async () => {
    const app = await render(Labelled, { providers: [provideWebCompat()] });
    assert.equal(screen.getByTestId('label').props['textContent'], undefined);
    assert.ok(screen.getByText('Apple'));
    app.instance.label.set('Banana');
    await settle();
    assert.ok(screen.getByText('Banana'));
    assert.equal(screen.queryByText('Apple'), null);
    app.instance.label.set(null);
    await settle();
    assert.equal(screen.queryByText('Banana'), null);
  });
});

describe('@ng-native/web-compat events a script dispatches', () => {
  /** A listener that notes where it was and in which phase, as `name phase`. */
  const noting = (heard: string[], name: string) => (event: Dom) =>
    void heard.push(`${name} ${event.eventPhase}`);

  it('goes down from the window to the target and back up, as the DOM orders it', async () => {
    const { app, card } = await mount();
    const document = app.instance.document;
    const row = card.firstElementChild;
    const heard: string[] = [];
    for (const [name, at] of [
      ['window', globalThis],
      ['document', document],
      ['card', card],
      ['row', row],
    ] as const) {
      at.addEventListener('picked', noting(heard, `${name} capture`), true);
      at.addEventListener('picked', noting(heard, name));
    }
    let seen: Dom;
    row.addEventListener('picked', (event: Dom) => {
      seen = {
        target: event.target,
        current: event.currentTarget,
        path: event.composedPath(),
        trusted: event.isTrusted,
      };
    });
    const event = new Event('picked', { bubbles: true });
    assert.equal(row.dispatchEvent(event), true);
    assert.deepEqual(heard, [
      'window capture 1',
      'document capture 1',
      'card capture 1',
      'row capture 2',
      'row 2',
      'card 3',
      'document 3',
      'window 3',
    ]);
    assert.equal(seen.target, row);
    assert.equal(seen.current, row);
    assert.equal(seen.trusted, false);
    assert.deepEqual(seen.path.slice(0, 2), [row, card]);
    assert.deepEqual(seen.path.slice(-2), [document, globalThis]);
    assert.equal(event.eventPhase, 0, 'and none once it is over');
    assert.equal(event.currentTarget, null);
    assert.equal(event.target, row);
    // An event that does not bubble is heard by the capture listeners and at the target only.
    heard.length = 0;
    row.dispatchEvent(new Event('picked'));
    assert.deepEqual(heard, [
      'window capture 1',
      'document capture 1',
      'card capture 1',
      'row capture 2',
      'row 2',
    ]);
  });

  it('stops where a listener says, and says whether the default was prevented', async () => {
    const { card } = await mount();
    const row = card.firstElementChild;
    const heard: string[] = [];
    let stop: 'none' | 'propagation' | 'immediate' = 'propagation';
    row.addEventListener('picked', (event: Dom) => {
      heard.push('row one');
      if (stop === 'propagation') event.stopPropagation();
      if (stop === 'immediate') event.stopImmediatePropagation();
      event.preventDefault();
    });
    row.addEventListener('picked', () => void heard.push('row two'));
    card.addEventListener('picked', () => void heard.push('card'));
    assert.equal(
      row.dispatchEvent(new Event('picked', { bubbles: true, cancelable: true })),
      false,
    );
    assert.deepEqual(heard, ['row one', 'row two']);
    heard.length = 0;
    stop = 'immediate';
    row.dispatchEvent(new Event('picked', { bubbles: true }));
    assert.deepEqual(heard, ['row one']);
    heard.length = 0;
    stop = 'none';
    const plain = new Event('picked', { bubbles: true });
    assert.equal(row.dispatchEvent(plain), true, 'nothing to prevent where it cannot be');
    assert.equal(plain.defaultPrevented, false);
    assert.deepEqual(heard, ['row one', 'row two', 'card']);
  });

  it('takes the options a listener is added with, and an object with `handleEvent`', async () => {
    const { card } = await mount();
    const heard: string[] = [];
    let passiveSaw: boolean | undefined;
    card.addEventListener('picked', () => void heard.push('once'), { once: true });
    card.addEventListener(
      'picked',
      (event: Dom) => {
        event.preventDefault();
        passiveSaw = event.defaultPrevented;
      },
      { passive: true },
    );
    const object = {
      handleEvent(this: unknown, event: Dom) {
        heard.push(`object ${this === object} ${event.currentTarget === card}`);
      },
    };
    card.addEventListener('picked', object);
    card.addEventListener('picked', object, { capture: false });
    const capture = () => void heard.push('capture');
    card.addEventListener('picked', capture, { capture: true });
    const event = new Event('picked', { cancelable: true });
    assert.equal(card.dispatchEvent(event), true, 'a passive listener cannot prevent it');
    assert.equal(passiveSaw, false);
    assert.deepEqual(heard, ['capture', 'once', 'object true true']);
    heard.length = 0;
    // Removed by the phase it was added for: without `capture` it is another listener.
    card.removeEventListener('picked', capture);
    card.removeEventListener('picked', object, false);
    card.dispatchEvent(new Event('picked'));
    assert.deepEqual(heard, ['capture']);
    card.removeEventListener('picked', capture, { capture: true });
    heard.length = 0;
    card.dispatchEvent(new Event('picked'));
    assert.deepEqual(heard, []);
  });

  it('takes a listener away when the signal it was added with is aborted', async () => {
    const { card } = await mount();
    let heard = 0;
    const controller = new AbortController();
    card.addEventListener('picked', () => heard++, { signal: controller.signal });
    card.dispatchEvent(new Event('picked'));
    controller.abort();
    card.dispatchEvent(new Event('picked'));
    assert.equal(heard, 1);
  });

  it('goes on to the next listener past one that throws', async () => {
    const { card } = await mount();
    const heard: string[] = [];
    const report = globals.reportError;
    const reported: unknown[] = [];
    globals.reportError = (error: unknown) => void reported.push(error);
    try {
      card.addEventListener('picked', () => {
        throw new Error('broken');
      });
      card.addEventListener('picked', () => void heard.push('after'));
      card.dispatchEvent(new Event('picked'));
      assert.deepEqual(heard, ['after']);
      assert.equal((reported[0] as Error).message, 'broken');
    } finally {
      if (report === undefined) delete globals.reportError;
      else globals.reportError = report;
    }
  });

  it('reports what a listener throws to the window where the runtime cannot', async () => {
    const { card } = await mount();
    const report = globals.reportError;
    delete globals.reportError;
    const heard: string[] = [];
    const onError = (event: Dom) => {
      heard.push(`error ${event.message}`);
      event.preventDefault();
    };
    try {
      globalThis.addEventListener('error', onError);
      card.addEventListener('picked', () => {
        throw new Error('broken');
      });
      card.dispatchEvent(new Event('picked'));
      assert.deepEqual(heard, ['error broken']);
    } finally {
      globalThis.removeEventListener('error', onError);
      if (report !== undefined) globals.reportError = report;
    }
  });

  it('has passive touches on the document, unless a listener says it is not', async () => {
    const { app } = await mount();
    const document = app.instance.document;
    // A touch listener on the document cannot stop a scroll unless it says it is not passive.
    let prevented: boolean | undefined;
    const touched = (each: Dom) => {
      each.preventDefault();
      prevented = each.defaultPrevented;
    };
    document.addEventListener('touchmove', touched);
    document.dispatchEvent(new Event('touchmove', { cancelable: true }));
    assert.equal(prevented, false);
    document.removeEventListener('touchmove', touched);
    document.addEventListener('touchmove', touched, { passive: false });
    document.dispatchEvent(new Event('touchmove', { cancelable: true }));
    assert.equal(prevented, true);
    document.removeEventListener('touchmove', touched);
  });

  it('dispatches on the window and the document', async () => {
    const { app } = await mount();
    const document = app.instance.document;
    const heard: string[] = [];
    globalThis.addEventListener('picked', noting(heard, 'window'));
    document.addEventListener('picked', noting(heard, 'document'));
    document.dispatchEvent(new CustomEvent('picked', { bubbles: true }));
    globalThis.dispatchEvent(new Event('picked'));
    assert.deepEqual(heard, ['document 2', 'window 3', 'window 2']);
  });

  it('is heard by a template’s listener, and a click once, from a script or a press', async () => {
    const app = await render(Heard, { providers: [provideWebCompat()] });
    await settle();
    const { heard, host } = app.instance;
    const inner = host.firstElementChild.firstElementChild;
    const own: string[] = [];
    inner.addEventListener('click', () => void own.push('click'));
    inner.dispatchEvent(new Event('click', { bubbles: true }));
    assert.deepEqual(heard, ['inner', 'outer']);
    assert.deepEqual(own, ['click']);
    inner.dispatchEvent(new CustomEvent('picked', { bubbles: true }));
    assert.deepEqual(heard, ['inner', 'outer', 'picked']);
    heard.length = 0;
    own.length = 0;
    await userEvent.press(screen.getByTestId('inner'));
    assert.deepEqual(heard, ['inner', 'outer']);
    assert.deepEqual(own, ['click']);
  });

  it('passes a press on up the tree after a listener sends its event on elsewhere', async () => {
    // A listener that hands the click it heard to another element, as a menu forwards one.
    const app = await render(Heard, { providers: [provideWebCompat()] });
    await settle();
    const { heard, host, document } = app.instance;
    const inner = host.firstElementChild.firstElementChild;
    const elsewhere = document.createElement('div');
    const forwarded: string[] = [];
    elsewhere.addEventListener('click', (event: Dom) => void forwarded.push(event.type));
    inner.addEventListener('click', (event: Dom) => void elsewhere.dispatchEvent(event));
    await userEvent.press(screen.getByTestId('inner'));
    assert.deepEqual(forwarded, ['click']);
    assert.deepEqual(heard, ['inner', 'outer']);
  });

  it('has an `Event` and a `CustomEvent` where the runtime has none', async () => {
    const target = globalThis as Dom;
    const [Native, NativeCustom] = [target.Event, target.CustomEvent];
    delete target.Event;
    delete target.CustomEvent;
    try {
      const { card } = await mount();
      const Made = target.Event;
      assert.equal(typeof Made, 'function');
      let detail: unknown;
      card.addEventListener('picked', (event: Dom) => (detail = event.detail));
      const event = new target.CustomEvent('picked', { detail: 7, cancelable: true });
      assert.equal(event instanceof Made, true);
      assert.equal(event.type, 'picked');
      assert.equal(event.cancelable, true);
      assert.equal(Made.AT_TARGET, 2);
      card.dispatchEvent(event);
      assert.equal(detail, 7);
      assert.throws(() => new Made(), TypeError);
      cleanup();
      assert.equal(target.Event, undefined, 'taken away with the app');
    } finally {
      target.Event = Native;
      target.CustomEvent = NativeCustom;
    }
  });
});
