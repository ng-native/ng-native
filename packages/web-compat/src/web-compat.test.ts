/**
 * `@ng-native/web-compat`: engine nodes answering to the DOM members a component library written
 * for the browser calls, each one going through the engine's own mutation API.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, ElementRef, Renderer2, inject, signal } from '@angular/core';
import { Text, TextInput, View } from '@ng-native/components';
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
  return { app, host, card: host.querySelector('.card') as Dom };
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

  it('matches selectors, and finds what does under a node', async () => {
    const { host, card } = await mount();
    const [first, second] = card.querySelectorAll('.row');
    assert.deepEqual([first, second], card.childList);
    assert.equal(host.querySelector('#second'), second);
    assert.equal(host.querySelector('view.row.first'), first);
    assert.equal(host.querySelector('[data-kind="a"] .row'), first);
    assert.equal(host.querySelector('[data-kind="b"] .row'), null);
    assert.equal(host.querySelector('[id=second]'), second);
    assert.equal(second.closest('.card'), card);
    assert.equal(second.matches('.row, .other'), true);
    assert.equal(first.matches('#second'), false);
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

  it('sets inline styles and custom properties', async () => {
    const { card } = await mount();
    assert.equal(card.ownerDocument.createTextNode('a').style, undefined, 'a text has none');
    card.style.opacity = '0.5';
    card.style.setProperty('margin-top', '4px');
    // Read back as written, which is text in a browser too; the view is given the number.
    assert.equal(card.style.opacity, '0.5');
    assert.equal(card.style.getPropertyValue('margin-top'), '4px');
    await settle();
    const view = screen.getByTestId('card');
    assert.equal(view.props['opacity'], 0.5);
    assert.equal(view.props['marginTop'], 4);
    // A custom property is the element's token, in scope for what it holds, until it is taken away.
    card.style.setProperty('--gap', '6px');
    assert.equal(card.style.getPropertyValue('--gap'), '6px');
    assert.deepEqual(card.customProperties['--gap'], { length: 6 });
    card.style.removeProperty('--gap');
    assert.equal(card.customProperties?.['--gap'], undefined);
    // A copy has them too, as it has the attribute.
    const copy = card.cloneNode();
    assert.equal(copy.style.getPropertyValue('margin-top'), '4px');
    assert.equal(copy.getAttribute('style'), card.getAttribute('style'));
    card.style.removeProperty('margin-top');
    assert.equal(card.style.marginTop, '');
    assert.equal(copy.style.marginTop, '4px', 'its own, apart from the one it is a copy of');
  });

  it('gives each side its own part of a shorthand written on an element', async () => {
    // A stylesheet's rule compiles to a value a side, and a native view reads a side before
    // the shorthand: `border-radius: 3rem` bound over a rule's corners was the rule's corners.
    const { card } = await mount();
    card.style.setProperty('border-radius', '3rem');
    card.style.setProperty('padding', '1rem 1rem 1rem 1.5rem');
    card.style.setProperty('margin', '4px 8px');
    card.style.setProperty('border-width', '1px 2px 3px');
    card.style.setProperty('border-color', 'red rgb(0, 0, 255)');
    card.style.setProperty('gap', '4px 1rem');
    await settle();
    const view = screen.getByTestId('card');
    const sides = (name: string, end = '') =>
      ['Top', 'Right', 'Bottom', 'Left'].map((side) => view.props[`${name}${side}${end}`]);
    assert.deepEqual(
      ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(
        (corner) => view.props[`border${corner}Radius`],
      ),
      [48, 48, 48, 48],
    );
    assert.deepEqual(sides('padding'), [16, 16, 16, 24]);
    assert.deepEqual(sides('margin'), [4, 8, 4, 8]);
    assert.deepEqual(sides('border', 'Width'), [1, 2, 3, 2]);
    assert.deepEqual(sides('border', 'Color'), ['red', 'rgb(0, 0, 255)', 'red', 'rgb(0, 0, 255)']);
    assert.deepEqual([view.props['rowGap'], view.props['columnGap']], [4, 16]);
    // Nothing is left of the shorthand itself, which a view would read as text.
    for (const whole of [
      'padding',
      'margin',
      'borderRadius',
      'borderWidth',
      'borderColor',
      'gap',
    ]) {
      assert.equal(view.props[whole] ?? null, null, whole);
    }
    // Read back as it was written, and taken away side by side.
    assert.equal(card.style.getPropertyValue('padding'), '1rem 1rem 1rem 1.5rem');
    card.style.removeProperty('padding');
    card.style.removeProperty('border-radius');
    await settle();
    const after = screen.getByTestId('card').props;
    assert.deepEqual(
      ['Top', 'Right', 'Bottom', 'Left'].map((side) => after[`padding${side}`] ?? null),
      [null, null, null, null],
    );
    assert.equal(after['borderTopLeftRadius'] ?? null, null);
    assert.equal(after['marginTop'], 4, 'what was not taken away is as it was');
  });

  it('reads a border written whole on an element, and a side of one', async () => {
    const { card } = await mount();
    card.style.setProperty('border', '1px solid rgba(75, 175, 80, 0.3)');
    await settle();
    const sides = (end: string) =>
      ['Top', 'Right', 'Bottom', 'Left'].map(
        (side) => screen.getByTestId('card').props[`border${side}${end}`] ?? null,
      );
    assert.deepEqual(sides('Width'), [1, 1, 1, 1]);
    assert.deepEqual(sides('Color'), Array(4).fill('rgba(75, 175, 80, 0.3)'));
    assert.equal(screen.getByTestId('card').props['borderStyle'], 'solid');
    assert.equal(screen.getByTestId('card').props['border'] ?? null, null);
    // One side over it, in any order of its parts, and one taken away with `none`.
    card.style.setProperty('border-bottom', 'dashed red 0.25rem');
    card.style.setProperty('border-left', 'none');
    await settle();
    assert.deepEqual(sides('Width'), [1, 1, 4, 0]);
    assert.equal(sides('Color')[2], 'red');
    // Taken away whole, its sides go with it, as they are the same properties in a browser.
    card.style.removeProperty('border');
    await settle();
    assert.deepEqual(sides('Width'), [null, null, null, null]);
  });

  it('sets a flex written with all three of its parts as each part', async () => {
    // A panel that shares a row by its size binds `flex: 50 1 0`. A view's `flex` is one number.
    const { card } = await mount();
    card.style.flex = '50 1 0';
    await settle();
    const props = () => screen.getByTestId('card').props;
    assert.deepEqual(
      [props()['flex'], props()['flexGrow'], props()['flexShrink'], props()['flexBasis']],
      [undefined, 50, 1, 0],
    );
    card.style.flex = 'none';
    await settle();
    assert.deepEqual(
      [props()['flexGrow'], props()['flexShrink'], props()['flexBasis']],
      [0, 0, 'auto'],
    );
    card.style.flex = '2';
    await settle();
    assert.equal(props()['flex'], 2, 'and one number is the flex a view reads');
    assert.equal(props()['flexGrow'] ?? undefined, undefined);
  });

  it('reads a transform back as the matrix it comes to, as a browser computes one', async () => {
    // A drawer dragged down reads how far from `matrix(1, 0, 0, 1, 0, 150)`, by its sixth number.
    const { card } = await mount();
    const computed = () => window.getComputedStyle(card as never).transform;
    assert.equal(computed(), 'none');
    card.style.transform = 'translateY(150px)';
    assert.equal(computed(), 'matrix(1, 0, 0, 1, 0, 150)');
    card.style.transform = 'translate(10px, -4px) scale(2)';
    assert.equal(computed(), 'matrix(2, 0, 0, 2, 10, -4)');
    card.style.transform = 'scale(2) translateX(5px)';
    assert.equal(computed(), 'matrix(2, 0, 0, 2, 10, 0)');
    // One this does not work out is left as it was written.
    card.style.transform = 'rotate(45deg)';
    assert.equal(computed(), 'rotate(45deg)');
    card.style.transform = '';
    assert.equal(computed(), 'none');
  });

  it('appends what it makes, and reads its style back once it is committed and seen', async () => {
    const { card } = await mount();
    const ripple = document.createElement('div') as unknown as typeof card & { bornIn?: number };
    ripple.setAttribute('testID', 'ripple');
    ripple.style.width = '40px';
    ripple.style.transitionDuration = '225ms';
    card.append(ripple as never);
    const computed = window.getComputedStyle(ripple as never);
    // Committed by the read, as a browser lays out for one: nothing waited for a render.
    assert.equal(screen.getByTestId('ripple').props['width'], 40);
    assert.equal(computed.transitionDuration, '225ms');
    assert.equal(ripple.bornIn, undefined);
    ripple.style.opacity = '0';
    ripple.style.transitionDelay = '0.1s';
    await settle();
    const style = (ripple as unknown as { props: { style: Record<string, unknown> } }).props.style;
    assert.deepEqual(
      [style['opacity'], style['$transitionDuration'], style['$transitionDelay']],
      [0, 225, 100],
    );
  });

  it('sets a background written whole as the colour or the gradient it is', async () => {
    // A swatch binds `background` to a colour, and a track to a gradient it worked out.
    const { card } = await mount();
    const props = () => screen.getByTestId('card').props;
    card.style.background = '#f01e2b';
    await settle();
    assert.equal(props()['backgroundColor'], '#f01e2b');
    card.style.background = 'linear-gradient(to right, rgb(255, 0, 0), rgb(0, 0, 255))';
    await settle();
    const [image] = props()['experimental_backgroundImage'] as { type: string }[];
    assert.equal(image!.type, 'linear-gradient');
    assert.equal(props()['backgroundColor'] ?? null, null);
    card.style.background = 'rgb(0, 128, 0)';
    await settle();
    assert.equal(props()['experimental_backgroundImage'] ?? null, null);
    assert.equal(props()['backgroundColor'], 'rgb(0, 128, 0)');
  });
});

describe('@ng-native/web-compat document and window', () => {
  it('creates engine nodes, and draws what is appended to the body over the app', async () => {
    const { app, host } = await mount();
    const document = app.instance.document;
    assert.equal(globals.document, document);
    assert.equal(host.ownerDocument, document);
    assert.equal(document.querySelector('#second'), document.getElementById('second'));
    // What the CDK's live announcer looks for an element it left behind with.
    assert.deepEqual(
      [...document.getElementsByClassName('row first')],
      [document.querySelector('.row.first')],
    );

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
    // And finds them by those names: a library looks for the `body` it puts its overlays in.
    assert.equal(document.querySelector('body'), document.body);
    assert.equal(document.body.matches('body'), true);
    assert.equal(document.querySelector('html'), document.documentElement);
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
    const { card, host } = await mount();
    const first = host.querySelector('.first') as Dom;
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
    // Out and back, as a list scrolled down and up again: still a drag, as an element's click says.
    await fireEvent(area, 'touchStart', finger(40, 60));
    await fireEvent(area, 'touchMove', finger(40, 140));
    await fireEvent(area, 'touchEnd', finger(41, 61, false));
    assert.equal(clicks, 1, 'a finger that went far and came back was dragging');
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
    const row = card.querySelector('.first');
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
    const row = card.querySelector('.first');
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
    const inner = host.querySelector('.inner');
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
    const inner = host.querySelector('.inner');
    const elsewhere = document.createElement('div');
    const forwarded: string[] = [];
    elsewhere.addEventListener('click', (event: Dom) => void forwarded.push(event.type));
    inner.addEventListener('click', (event: Dom) => void elsewhere.dispatchEvent(event));
    await userEvent.press(screen.getByTestId('inner'));
    assert.deepEqual(forwarded, ['click']);
    assert.deepEqual(heard, ['inner', 'outer']);
  });

  it('has `window.event` while a listener is told one, and one a script sets in its place', async () => {
    const { card } = await mount();
    const seen: unknown[] = [];
    card.addEventListener('picked', () => void seen.push(globals.event));
    const event = new Event('picked');
    card.dispatchEvent(event);
    assert.deepEqual(seen, [event]);
    assert.equal(globals.event, undefined);
    // Written by a script, it is kept, and no event is put there again.
    globals.event = 'mine';
    card.dispatchEvent(new Event('picked'));
    assert.deepEqual(seen, [event, 'mine']);
  });

  it('makes an event with `document.createEvent`, to be given its type before it is sent', async () => {
    // How a chart library fires its own events once a document has `createEvent`.
    const { app, card } = await mount();
    const document = app.instance.document;
    const heard: Dom[] = [];
    card.addEventListener('legendItemClick', (event: Dom) => {
      heard.push(event);
      event.preventDefault();
    });
    const unsent = document.createEvent('Events');
    assert.throws(() => card.dispatchEvent(unsent), { name: 'InvalidStateError' });
    const event = document.createEvent('Events');
    event.initEvent('legendItemClick', true, true);
    Object.assign(event, { legendItem: 'first' });
    assert.equal(card.dispatchEvent(event), false);
    assert.equal(heard.length, 1);
    assert.equal(heard[0].legendItem, 'first');
    assert.equal(heard[0].type, 'legendItemClick');
    assert.equal(event.defaultPrevented, true);
    const custom = document.createEvent('CustomEvent');
    custom.initCustomEvent('picked', false, false, { at: 3 });
    let detail: unknown;
    card.addEventListener('picked', (each: Dom) => (detail = each.detail));
    card.dispatchEvent(custom);
    assert.deepEqual(detail, { at: 3 });
    assert.throws(() => document.createEvent('NoSuchEvent'), { name: 'NotSupportedError' });
    // Where the runtime has no `Event`, this package's is made, and it too has no type yet.
    const runtime = globals.Event;
    try {
      globals.Event = undefined;
      const made = document.createEvent('Events');
      assert.throws(() => card.dispatchEvent(made), { name: 'InvalidStateError' });
    } finally {
      globals.Event = runtime;
    }
  });

  it('clicks an element from `click()` once, though a listener of the click calls it again', async () => {
    const { app } = await mount();
    const button = app.instance.document.createElement('button');
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks++;
      button.click();
    });
    button.click();
    assert.equal(clicks, 1);
    button.click();
    assert.equal(clicks, 2, 'and again once that click is over');
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

@Component({
  selector: 'x-panels',
  template: `
    <div testID="shown" [hidden]="false" style="opacity: 0.5">One</div>
    <div testID="gone" [hidden]="gone()" style="opacity: 0.5">Two</div>
    <div testID="static" hidden>Three</div>
    <div testID="found" hidden="until-found">Four</div>
    <div testID="plain">Five</div>
    <span testID="label" [textContent]="label()"></span>
  `,
})
class Panels {
  readonly gone = signal(true);
  readonly label = signal<string | null>('Apple');
}

describe('@ng-native/web-compat hidden', () => {
  it('takes a hidden element out of the layout, and puts it back', async () => {
    const app = await render(Panels, { providers: [provideWebCompat()] });
    const hidden = { includeHiddenElements: true };
    const block = screen.getByTestId('plain').props['display'];
    assert.equal(screen.getByTestId('shown').props['display'], block);
    // Not displayed is no view: not there for anyone to find, hidden elements and all.
    assert.equal(screen.queryByTestId('gone', hidden), null);
    assert.equal(screen.queryByTestId('static', hidden), null);
    app.instance.gone.set(false);
    await settle();
    assert.equal(screen.getByTestId('gone').props['display'], block);
    assert.equal(screen.getByTestId('gone').props['opacity'], 0.5, 'with its own style');
  });

  it('gives a hidden element back the display of its own it had, and none where it had none', async () => {
    const { card } = await mount();
    const shown = () => screen.queryByTestId('card');
    card.style.display = 'flex';
    card.hidden = true;
    await settle();
    assert.equal(shown(), null);
    card.hidden = false;
    await settle();
    assert.equal(shown()?.props['display'], 'flex');
    card.style.removeProperty('display');
    card.setAttribute('hidden', '');
    await settle();
    assert.equal(shown(), null);
    card.removeAttribute('hidden');
    await settle();
    assert.equal(shown()?.props['display'] ?? null, null);
  });

  it('keeps one hidden until found in the layout, where a library measures it', async () => {
    // A collapsible's content: no height and clipped by its own styles while it is closed,
    // and measured as it opens. A browser keeps its box, and only skips drawing what is in it.
    await render(Panels, { providers: [provideWebCompat()] });
    const found = (globalThis as unknown as { document: Dom }).document.querySelector(
      '[testID="found"]',
    );
    // The display any div has, which a hidden one is given back.
    const block = screen.getByTestId('plain').props['display'];
    assert.equal(screen.getByTestId('found').props['display'], block);
    found.removeAttribute('hidden');
    await settle();
    assert.equal(screen.getByTestId('found').props['display'], block);
    found.setAttribute('hidden', '');
    await settle();
    assert.equal(screen.queryByTestId('found', { includeHiddenElements: true }), null);
  });

  it('draws the text bound to textContent, and follows it', async () => {
    const app = await render(Panels, { providers: [provideWebCompat()] });
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

@Component({
  selector: 'x-insets',
  template: `
    <div
      testID="thumb"
      [style.inset-inline-start]="start()"
      [style.inset-block]="block()"
      [style.visibility]="shown() ? null : 'hidden'"
      [style.opacity]="0.5"
      style="inset-inline-end: 12px"
    ></div>
  `,
})
class Insets {
  readonly start = signal<string | null>('calc(30% + 4.5px)');
  readonly block = signal<string | null>('0px 70%');
  readonly shown = signal(true);
}

@Component({
  selector: 'x-units',
  template: `<div testID="units" [style]="styles"></div>`,
})
class Units {
  readonly styles = {
    letterSpacing: '-0.5em',
    lineHeight: 1,
    boxShadow: 'none',
    width: '10ch',
    marginTop: '1.5rem',
    height: '50%',
    fontSize: '14px',
    opacity: 0.5,
    color: 'transparent',
  };
}

@Component({
  selector: 'x-origin',
  template: `<div testID="origin" [style.transform-origin]="origin()"></div>`,
})
class Origin {
  readonly origin = signal('left top');
}

describe('@ng-native/web-compat inline styles', () => {
  const thumb = () => screen.getByTestId('thumb', { includeHiddenElements: true }).props;
  const none = (key: string) => assert.equal(thumb()[key] ?? null, null, key);

  it('sets a logical inset as the side the view reads, and a shorthand as both', async () => {
    await render(Insets, { providers: [provideWebCompat()] });
    assert.equal(thumb()['top'], 0);
    assert.equal(thumb()['bottom'], '70%');
    assert.equal(thumb()['end'], 12, 'from a style attribute too');
    for (const key of ['insetInlineStart', 'insetBlock', 'insetInlineEnd']) none(key);
  });

  it('works out a calc() of percentages and lengths a library binds, for a size and an inset', async () => {
    // A grid list's tile: its width and where it starts, each a sum written out in full.
    const app = await render(Insets, { providers: [provideWebCompat()] });
    const node = (globalThis as unknown as { document: Dom }).document.querySelector(
      '[testID="thumb"]',
    );
    node.style.width = 'calc(((25% - (8px * 0.75)) * 3) + (2 * 8px))';
    node.style.height = 'calc((80px * 2) + 8px)';
    app.instance.start.set('calc((25% - 6px + 8px) * 3)');
    await settle();
    // The sum of the two is the engine's to finish, from the box it is a share of.
    assert.equal(node.props.style.width, 'calc(75% + -2px)');
    assert.equal(thumb()['height'], 168);
    assert.equal(thumb()['start'], '75%');
    assert.equal(thumb()['marginStart'], 6);
  });

  it('sets a percentage and a length as an inset and a margin, and takes both away', async () => {
    const app = await render(Insets, { providers: [provideWebCompat()] });
    assert.equal(thumb()['start'], '30%');
    assert.equal(thumb()['marginStart'], 4.5);
    app.instance.start.set('calc(50% - 2px)');
    await settle();
    assert.equal(thumb()['start'], '50%');
    assert.equal(thumb()['marginStart'], -2);
    // A library's arithmetic, written out: a negative length added.
    app.instance.start.set('calc(70% + -3.25px)');
    await settle();
    assert.equal(thumb()['start'], '70%');
    assert.equal(thumb()['marginStart'], -3.25);
    app.instance.start.set('40%');
    await settle();
    assert.equal(thumb()['start'], '40%');
    none('marginStart');
    app.instance.start.set(null);
    app.instance.block.set(null);
    await settle();
    for (const key of ['start', 'top', 'bottom']) none(key);
  });

  it('hides an element that keeps its space, and shows it again', async () => {
    const app = await render(Insets, { providers: [provideWebCompat()] });
    app.instance.shown.set(false);
    await settle();
    assert.equal(thumb()['opacity'], 0);
    none('visibility');
    // And takes no touch, over an opacity of its own: Highcharts hides a select it lays over its
    // range buttons with both, and the select took their taps.
    assert.equal(thumb()['pointerEvents'], 'none');
    app.instance.shown.set(true);
    await settle();
    assert.equal(thumb()['opacity'], 0.5);
    assert.notEqual(thumb()['pointerEvents'], 'none');
  });

  it('sets no value a native view cannot read: a length in a unit it has none of', async () => {
    // Android throws on a string where it reads a number, which takes the whole screen down.
    await render(Units, { providers: [provideWebCompat()] });
    const props = screen.getByTestId('units').props;
    for (const key of ['letterSpacing', 'lineHeight', 'boxShadow', 'width']) {
      assert.equal(props[key] ?? null, null, key);
    }
    assert.equal(props['marginTop'], 24, 'a rem is sixteen points');
    assert.equal(props['height'], '50%', 'a percentage is one it reads');
    assert.equal(props['fontSize'], 14);
    assert.equal(props['opacity'], 0.5);
    assert.equal(props['color'], 'transparent');
  });

  it('sets a transform origin as the point a view reads, from the words CSS has for it', async () => {
    const app = await render(Origin, { providers: [provideWebCompat()] });
    const origin = () => screen.getByTestId('origin').props['transformOrigin'];
    assert.deepEqual(origin(), ['0%', '0%', 0]);
    for (const [written, read] of [
      ['right bottom', ['100%', '100%', 0]],
      ['top right', ['100%', '0%', 0]],
      ['center', ['50%', '50%', 0]],
      ['10px 25%', [10, '25%', 0]],
    ] as const) {
      app.instance.origin.set(written);
      await settle();
      assert.deepEqual(origin(), read, written);
    }
  });

  it('reads what a library sets on element.style the same way, and hands it back as written', async () => {
    // The CDK sets a menu's transform origin this way, and Spartan reads it back for the side.
    const app = await render(Origin, { providers: [provideWebCompat()] });
    const node = app.componentRef.location.nativeElement.children[0];
    const props = () => screen.getByTestId('origin').props;
    node.style.transformOrigin = 'right bottom';
    node.style.letterSpacing = '-0.5em';
    node.style.insetInlineStart = 'calc(50% + 2px)';
    node.style.setProperty('margin-top', '1rem');
    await settle();
    assert.deepEqual(props()['transformOrigin'], ['100%', '100%', 0]);
    assert.equal(props()['letterSpacing'] ?? null, null);
    assert.equal(props()['start'], '50%');
    assert.equal(props()['marginStart'], 2);
    assert.equal(props()['marginTop'], 16);
    assert.equal(node.style.transformOrigin, 'right bottom');
    assert.equal(node.style.getPropertyValue('margin-top'), '1rem');
    node.style.removeProperty('transform-origin');
    node.style.insetInlineStart = '';
    await settle();
    assert.equal(props()['transformOrigin'] ?? null, null);
    assert.equal(props()['start'] ?? null, null);
    assert.equal(props()['marginStart'] ?? null, null);
    assert.equal(node.style.transformOrigin, '');
  });

  it('leaves the styles of an app that did not ask for the package as written', async () => {
    await render(Insets);
    // Not read as a `start` and a margin. The sum itself is the engine's to finish, and it
    // commits none under a name it has no box for.
    assert.equal(thumb()['insetInlineStart'], undefined);
    none('start');
  });
});

@Component({
  selector: 'x-padded',
  styles: `
    .list {
      padding: 4px 8px;
      display: flex;
      opacity: 0.5;
    }
  `,
  template: `<div testID="list" class="list"><div testID="row"></div></div>`,
})
class Padded {
  readonly host: Dom = inject(ElementRef).nativeElement;
}

describe('@ng-native/web-compat getComputedStyle', () => {
  const computed = (node: unknown) =>
    (
      globalThis as unknown as { getComputedStyle(node: unknown): Record<string, string> }
    ).getComputedStyle(node);

  it('answers what a rule gave an element, a length in pixels, and nothing as 0px', async () => {
    // A list that draws only the rows in sight adds its content's padding to its size: read
    // as a number from `0px`, and as no number at all from nothing.
    const app = await render(Padded, { providers: [provideWebCompat()] });
    await settle();
    const list = app.fixture.componentInstance.host.querySelector('.list');
    const style = computed(list);
    assert.deepEqual([style['paddingLeft'], style['paddingTop']], ['8px', '4px']);
    assert.deepEqual([style['display'], style['opacity']], ['flex', '0.5']);
    const row = computed(list.children[0]);
    assert.deepEqual(
      [row['paddingLeft'], row['marginTop'], row['borderTopWidth']],
      ['0px', '0px', '0px'],
    );
    // What is written on the element is over the rule, as it is in the cascade.
    list.style.paddingLeft = '12px';
    assert.equal(parseFloat(computed(list)['paddingLeft']!), 12);
  });
});

@Component({
  selector: 'x-links',
  template: `
    <button testID="button">Save</button><a testID="link" role="tab">More</a>
    <button testID="off" [disabled]="off()" aria-expanded="true">Off</button>
  `,
})
class Links {
  readonly off = signal(true);
}

@Component({
  selector: 'x-held',
  template: `
    <div testID="area" (contextmenu)="menus.push($event)" (click)="clicks.set(clicks() + 1)"></div>
    <div testID="plain"></div>
  `,
})
class Held {
  readonly menus: MouseEvent[] = [];
  readonly clicks = signal(0);
}

@Component({
  selector: 'x-form',
  template: `
    <form testID="form" (submit)="sent($event)" (reset)="said('reset')">
      <button testID="send">Send</button>
      <button testID="plain" type="button">Plain</button>
      <button testID="held" type="submit" (click)="$event.preventDefault()">Held</button>
      <button testID="clear" type="reset">Clear</button>
    </form>
    <button testID="outside">Outside</button>
  `,
})
class Form {
  readonly heard: string[] = [];
  said(what: string): void {
    this.heard.push(what);
  }
  sent(event: { preventDefault(): void; target: { localName?: string } }): void {
    // A library stops the page from loading again, which is what a browser does with a form.
    event.preventDefault();
    this.heard.push(`submit ${event.target.localName}`);
  }
}

@Component({
  selector: 'x-checks',
  template: `
    <label testID="label" for="agree">Agree</label>
    <input
      testID="check"
      id="agree"
      type="checkbox"
      (click)="said('click')"
      (change)="said('change')"
    />
    <input testID="radio" type="radio" (click)="said('click')" (change)="said('change')" />
    <label testID="off-label" for="off">Off</label>
    <input testID="off" id="off" type="checkbox" disabled (change)="said('change')" />
    <input testID="bound" [attr.type]="kind" (change)="said('bound')" />
    <label testID="switch-label" for="switch">Switch</label>
    <button testID="switch" id="switch" role="switch" (click)="said('switch')">On</button>
  `,
})
class Checks {
  readonly kind = 'checkbox';
  readonly heard: string[] = [];
  said(what: string): void {
    this.heard.push(what);
  }
}

@Component({
  selector: 'x-label-for',
  imports: [TextInput],
  template: `
    <label testID="label" for="name">Full name</label>
    <text-input testID="name" id="name" />
    <label for="named">Other</label>
    <text-input testID="named" id="named" aria-label="Already named" />
    <text-input testID="third" id="third" />
  `,
})
class LabelFor {}

describe('@ng-native/web-compat buttons and links', () => {
  it('announces a disabled button as disabled, beside its other states, until it is enabled', async () => {
    const app = await render(Links, { providers: [provideWebCompat()] });
    const state = () => screen.getByTestId('off').props['accessibilityState'];
    assert.deepEqual(state(), { disabled: true, expanded: true });
    // Announced, and no attribute a library wrote.
    const off = globals.document.querySelectorAll('button')[1];
    assert.equal(off.hasAttribute('aria-disabled'), false);
    app.instance.off.set(false);
    await settle();
    assert.deepEqual(state(), { expanded: true });
    assert.equal(screen.getByTestId('button').props['accessibilityState'], undefined);
  });

  it('marks a button a pointer is over, for a hover style', async () => {
    await render(Links, { providers: [provideWebCompat()] });
    // On the node, where a stylesheet matches it: a `data-` attribute is not a native prop.
    const node = globals.document.querySelector('button');
    await fireEvent(screen.getByTestId('button'), 'topPointerEnter');
    assert.equal(node.getAttribute('data-hover'), 'true');
    await fireEvent(screen.getByTestId('button'), 'topPointerLeave');
    assert.equal(node.hasAttribute('data-hover'), false);
  });

  it('takes a press on a button or a link with no listener, which is :active while held', async () => {
    await render(Links, { providers: [provideWebCompat()] });
    const [button] = globals.document.querySelectorAll('button');
    const link = globals.document.querySelector('a');
    // And still once a listener it was given is taken off again.
    const listener = () => {};
    button.addEventListener('click', listener);
    button.removeEventListener('click', listener);
    for (const [id, node] of [
      ['button', button],
      ['link', link],
    ] as const) {
      await fireEvent(screen.getByTestId(id), 'touchStart', finger(5, 5));
      assert.equal(node.matches(':active'), true, id);
      await fireEvent(screen.getByTestId(id), 'touchEnd', finger(5, 5, false));
      assert.equal(node.matches(':active'), false, id);
    }
  });
});

describe('@ng-native/web-compat context menus', () => {
  it('delivers a finger held still as a context menu at the finger, and no click after', async () => {
    const app = await render(Held, { providers: [provideWebCompat()] });
    const area = screen.getByTestId('area');
    await fireEvent(area, 'touchStart', finger(40, 60));
    await new Promise((resolve) => setTimeout(resolve, 550));
    await fireEvent(area, 'touchEnd', finger(40, 60, false));
    assert.equal(app.instance.menus.length, 1);
    const { type, clientX, clientY, button } = app.instance.menus[0]!;
    assert.deepEqual(
      { type, clientX, clientY, button },
      { type: 'contextmenu', clientX: 40, clientY: 60, button: 0 },
    );
    assert.equal(app.instance.clicks(), 0, 'the hold was the menu, not a press');
    // None for a press, nor for a finger that moves away.
    await userEvent.press(area);
    assert.equal(app.instance.clicks(), 1);
    await fireEvent(area, 'touchStart', finger(40, 60));
    await fireEvent(area, 'touchMove', finger(80, 60));
    await new Promise((resolve) => setTimeout(resolve, 550));
    await fireEvent(area, 'touchEnd', finger(80, 60, false));
    assert.equal(app.instance.menus.length, 1);
  });

  it('tells the document of no click for a hold either, which would close the menu it opened', async () => {
    await render(Held, { providers: [provideWebCompat()] });
    let clicks = 0;
    globals.document.addEventListener('click', () => clicks++);
    await settle();
    const area = screen.getByTestId('area');
    await fireEvent(area, 'touchStart', finger(40, 60));
    await new Promise((resolve) => setTimeout(resolve, 550));
    await fireEvent(area, 'touchEnd', finger(40, 60, false));
    assert.equal(clicks, 0);
    // On an element with no listener of its own, which is what a press outside a menu lands on.
    await userEvent.press(screen.getByTestId('plain'));
    assert.equal(clicks, 1, 'and of the next press as before');
  });
});

describe('@ng-native/web-compat mouse events of a touch', () => {
  it('hears a touch on the document where it landed, and its mouse event after', async () => {
    const { card } = await mount();
    card.setAttribute('testID', 'pressed');
    await settle();
    const heard: unknown[] = [];
    const listen = (type: string) =>
      globals.document.addEventListener(type, (event: Dom) => {
        const { target, clientX, changedTouches } = event;
        // A touch is read by its place in the list, either way a library writes that.
        assert.equal(changedTouches?.item(0), changedTouches?.[0]);
        heard.push([type, target instanceof HTMLElement, clientX, changedTouches?.[0]?.clientY]);
        // Added while the touch is heard, as Material makes a ripple's own listener: it is in
        // time for the mouse event of the same press, which a browser sends afterwards.
        if (type === 'touchstart') listen('mousedown');
      });
    listen('touchstart');
    await settle();
    await touch('pressed', 'Start');
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(heard, [
      ['touchstart', true, 30, 20],
      ['mousedown', true, 30, 20],
    ]);
  });

  it('tells the document of the mouse a press is, to a listener added as the element heard it', async () => {
    // A ripple listens on its own element for the touch, and from there for the mouse on the
    // document: it is in time for the mouse of that same press.
    const { card } = await mount();
    const heard: string[] = [];
    card.addEventListener('touchstart', () =>
      globals.document.addEventListener('mousedown', () => void heard.push('mousedown')),
    );
    await settle();
    await touch('card', 'Start');
    await touch('card', 'End');
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(heard, ['mousedown']);
  });

  it('tells an element of a touch on it as the mouse going down and up, with where it is', async () => {
    // A handle that is dragged starts on its own `mousedown`, and asks whether that is a
    // `MouseEvent` to know where to read the place from: it is one, as a browser's is after a
    // touch, and says the place both ways, so either reading finds the finger.
    const { card } = await mount();
    const heard: unknown[] = [];
    const hear = (event: Dom) =>
      heard.push([
        event.type,
        event instanceof MouseEvent,
        event.clientX,
        event.touches?.[0]?.clientX,
        // The primary button, held while the finger is down, and one press.
        `${event.button} ${event.buttons} ${event.detail}`,
      ]);
    card.addEventListener('mousedown', hear);
    card.addEventListener('mouseup', hear);
    await settle();
    await touch('card', 'Start');
    await touch('card', 'End');
    assert.deepEqual(heard[0], ['mousedown', true, 30, 30, '0 1 1']);
    assert.deepEqual((heard[1] as unknown[])[0], 'mouseup');
    assert.deepEqual((heard[1] as unknown[])[4], '0 0 1');
  });

  it('gives a press to a template listener as a PointerEvent, a click among them', async () => {
    const app = await render(Drag, { providers: [provideWebCompat()] });
    const track = screen.getByTestId('track');
    await fireEvent(track, 'touchStart', finger(10, 5));
    await fireEvent(track, 'touchEnd', finger(10, 5, false));
    const clicked = app.instance.clicked as unknown;
    assert.equal(clicked instanceof PointerEvent, true);
    assert.equal(clicked instanceof MouseEvent, true);
  });
});

describe('@ng-native/web-compat forms', () => {
  it('submits a form from a press on its button, and resets it from its reset button', async () => {
    const app = await render(Form, { providers: [provideWebCompat()] });
    await settle();
    const { heard } = app.fixture.componentInstance;
    // A button with no type is a submit button; one that says `button` is not.
    for (const id of ['send', 'plain', 'clear', 'outside']) {
      await userEvent.press(screen.getByTestId(id));
      await settle();
    }
    assert.deepEqual(heard, ['submit form', 'reset']);
    // And a click a listener stopped submits nothing.
    await userEvent.press(screen.getByTestId('held'));
    await settle();
    assert.deepEqual(heard, ['submit form', 'reset']);
  });
});

describe('@ng-native/web-compat checkboxes and radios', () => {
  const checks = async () => {
    const app = await render(Checks, { providers: [provideWebCompat()] });
    await settle();
    return app.fixture.componentInstance.heard;
  };

  it('say click and then change when pressed', async () => {
    const heard = await checks();
    await userEvent.press(screen.getByTestId('check'));
    await settle();
    assert.deepEqual(heard, ['click', 'change']);
    await userEvent.press(screen.getByTestId('radio'));
    await settle();
    assert.deepEqual(heard, ['click', 'change', 'click', 'change']);
  });

  it('are checked by the time they say so, as a listener reads off what changed', async () => {
    // A library that keeps no state of its own reads `event.target.checked` in its `change`
    // listener, after asking whether the target is an input at all.
    await checks();
    const document = globals.document;
    const read: unknown[] = [];
    for (const input of [
      document.querySelector('#agree'),
      document.querySelector('[type=radio]'),
    ]) {
      input.addEventListener('change', (event: Dom) =>
        read.push([event.target instanceof globals.HTMLInputElement, event.target.checked]),
      );
    }
    await settle();
    for (const id of ['check', 'check', 'radio', 'radio']) {
      await userEvent.press(screen.getByTestId(id));
      await settle();
    }
    // A checkbox is checked and then not; a radio is checked and stays so.
    assert.deepEqual(read, [
      [true, true],
      [true, false],
      [true, true],
      [true, true],
    ]);
  });

  it('takes a press for as long as it is a checkbox, a radio or a button, and no longer', async () => {
    // One a library makes and listens to nothing on: the press is its type's alone.
    await checks();
    const input = globals.document.createElement('input');
    input.setAttribute('testID', 'made');
    globals.document.body.appendChild(input);
    await settle();
    const held = async () => {
      await fireEvent(screen.getByTestId('made'), 'touchStart', finger(5, 5));
      const active = input.matches(':active');
      await fireEvent(screen.getByTestId('made'), 'touchEnd', finger(5, 5, false));
      return active;
    };
    assert.equal(await held(), false);
    input.setAttribute('type', 'checkbox');
    assert.equal(await held(), true);
    input.setAttribute('type', 'text');
    assert.equal(await held(), false);
    input.setAttribute('type', 'radio');
    assert.equal(await held(), true);
    input.removeAttribute('type');
    assert.equal(await held(), false);
  });

  it('say change where the type is bound, and so set after the listener is added', async () => {
    // A library binds the type of the input it keeps under each choice it draws.
    const heard = await checks();
    await userEvent.press(screen.getByTestId('bound'));
    await settle();
    assert.deepEqual(heard, ['bound']);
  });

  it('say the same when their label is pressed, and nothing when disabled', async () => {
    const heard = await checks();
    await userEvent.press(screen.getByTestId('label'));
    await userEvent.press(screen.getByTestId('off'));
    await userEvent.press(screen.getByTestId('off-label'));
    await settle();
    assert.deepEqual(heard, ['click', 'change']);
  });

  it('are not the only controls a label clicks: a button is clicked by its label too', async () => {
    const heard = await checks();
    await userEvent.press(screen.getByTestId('switch-label'));
    await settle();
    assert.deepEqual(heard, ['switch']);
  });
});

describe('@ng-native/web-compat labels', () => {
  it('names the control a label is for, unless it has a name of its own', async () => {
    await render(LabelFor, { providers: [provideWebCompat()] });
    await settle();
    assert.equal(screen.getByTestId('name').props['accessibilityLabel'], 'Full name');
    assert.equal(screen.getByTestId('named').props['accessibilityLabel'], 'Already named');
    // Given another before the first was named, it names only the one it is for now.
    const label = globals.document.querySelector('label');
    label.setAttribute('for', 'third');
    label.setAttribute('for', 'name');
    await settle();
    assert.equal(screen.getByTestId('third').props['accessibilityLabel'] ?? null, null);
    assert.equal(screen.getByTestId('name').props['accessibilityLabel'], 'Full name');
  });

  it('focuses the control when its label is pressed, until the label is for another', async () => {
    const app = await render(LabelFor, { providers: [provideWebCompat()] });
    await settle();
    await userEvent.press(screen.getByTestId('label'));
    const focused = () =>
      app.fabric.commands
        .filter((command) => command.name === 'focus')
        .map((command) => command.node?.props['testID']);
    assert.deepEqual(focused(), ['name']);
    const label = globals.document.querySelector('label');
    label.setAttribute('for', 'named');
    await userEvent.press(screen.getByTestId('label'));
    assert.deepEqual(focused(), ['name', 'named']);
    // The control it was for is named by it no longer, and the one it names has its own name.
    await settle();
    assert.equal(screen.getByTestId('name').props['accessibilityLabel'] ?? null, null);
    assert.equal(screen.getByTestId('named').props['accessibilityLabel'], 'Already named');
    label.setAttribute('for', 'name');
    await settle();
    assert.equal(screen.getByTestId('name').props['accessibilityLabel'], 'Full name');
    label.removeAttribute('for');
    await userEvent.press(screen.getByTestId('label'));
    assert.deepEqual(focused(), ['name', 'named'], 'and none once it names none');
    await settle();
    assert.equal(screen.getByTestId('name').props['accessibilityLabel'] ?? null, null);
  });
});
