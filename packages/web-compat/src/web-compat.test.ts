/**
 * `@ng-native/web-compat`: engine nodes answering to the DOM members a component library written
 * for the browser calls, each one going through the engine's own mutation API.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Location } from '@angular/common';
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

const globals = globalThis as Dom;

const mount = async () => {
  const app = await render(Card, { providers: [provideWebCompat()] });
  const host = app.instance.host;
  return { app, host, card: host.querySelector('.card') as Dom };
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
    assert.equal(card.hasAttribute('data-kind'), false);

    card.classList.add('on');
    assert.equal(card.classList.contains('on'), true);
    assert.equal(card.className, 'card on');
    assert.equal(card.classList.toggle('on'), false);
    card.className = 'a b';
    assert.deepEqual([...card.classList], ['a', 'b']);
  });

  it('walks the tree and matches selectors', async () => {
    const { host, card } = await mount();
    const [first, second] = card.querySelectorAll('.row');
    assert.equal(host.querySelector('#second'), second);
    assert.equal(host.querySelector('view.row.first'), first);
    assert.equal(host.querySelector('[data-kind="a"] .row'), first);
    assert.equal(host.querySelector('[data-kind="b"] .row'), null);
    assert.equal(second.closest('.card'), card);
    assert.equal(second.matches('.row, .other'), true);
    assert.equal(second.id, 'second');
    assert.equal(second.getAttribute('id'), 'second');
    assert.equal(host.querySelector('[id=second]'), second);
    assert.equal(card.contains(second), true);
    assert.equal(second.contains(card), false);
    assert.equal(first.parentElement, card);
    assert.equal(card.firstElementChild, first);
    assert.equal(first.nextSibling, second);
    assert.equal(second.previousSibling, first);
    assert.equal(card.textContent, 'OneTwo');
    assert.equal(first.isConnected, true);
    assert.equal(first.nodeType, 1);
    assert.equal(first.localName, 'view');
    assert.equal(first.tagName, 'VIEW');
    assert.equal(first.nodeName, 'VIEW');
  });

  it('moves and removes nodes through the engine', async () => {
    const { card } = await mount();
    const [first, second] = card.querySelectorAll('.row');
    card.appendChild(first);
    assert.deepEqual(card.querySelectorAll('.row'), [second, first]);
    card.insertBefore(first, second);
    assert.equal(card.firstElementChild, first);
    second.remove();
    assert.equal(second.isConnected, false);
    await settle();
    assert.equal(screen.queryByText('Two'), null, 'and the commit follows');
  });

  it('sets inline styles and custom properties', async () => {
    const { card } = await mount();
    card.style.opacity = '0.5';
    card.style.setProperty('margin-top', '4px');
    assert.equal(card.style.opacity, 0.5);
    assert.equal(card.style.getPropertyValue('margin-top'), '4');
    await settle();
    const view = screen.getByTestId('card');
    assert.equal(view.props['opacity'], 0.5);
    assert.equal(view.props['marginTop'], 4);
    card.style.removeProperty('margin-top');
    assert.equal(card.style.marginTop, '');
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

  it('leaves a click to core, which listens for the touch a defer trigger does', async () => {
    const { card } = await mount();
    const listener = () => {};
    card.addEventListener('click', listener);
    assert.deepEqual([...card.listeners.keys()], ['topTouchEnd']);
    card.removeEventListener('click', listener);
    assert.equal(card.listeners.get('topTouchEnd').size, 0);
  });

  it('is gone with the app that asked for it, and absent from one that did not', async () => {
    const { host } = await mount();
    assert.equal(typeof host.getAttribute, 'function');
    cleanup();
    assert.equal(host.getAttribute, undefined);

    const plain = await render(Card);
    assert.equal(plain.instance.host.getAttribute, undefined);
  });

  it('stays while any app that asked for it is up', async () => {
    const one = await render(Card, { providers: [provideWebCompat()] });
    const two = await render(Card, { providers: [provideWebCompat()] });
    one.unmount();
    assert.equal(typeof two.instance.host.getAttribute, 'function');
  });
});

describe('@ng-native/web-compat document and window', () => {
  it('creates engine nodes, and draws what is appended to the body over the app', async () => {
    const { app, host } = await mount();
    const document = app.instance.document;
    assert.equal(globals.document, document);
    assert.equal(host.ownerDocument, document);
    assert.equal(document.querySelector('#second'), document.getElementById('second'));

    const overlay = document.createElement('DIV');
    overlay.setAttribute('testID', 'overlay');
    document.body.appendChild(overlay);
    await settle();
    assert.ok(screen.getByTestId('overlay'));
    const root = document.documentElement;
    assert.equal(root.children.at(-1), document.body, 'last under the root, so on top');
    assert.equal(document.body.props.pointerEvents, 'box-none');
  });

  it('has no body in the tree until something is appended to it', async () => {
    const { app } = await mount();
    assert.equal(app.instance.document.body.isConnected, false);
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

  it('measures a node from where native laid it out', async () => {
    const { app, card } = await mount();
    app.fabric.frames.set('View', { x: 10, y: 20, width: 100, height: 40 });
    assert.deepEqual(card.getBoundingClientRect(), {
      x: 10,
      y: 20,
      top: 20,
      left: 10,
      right: 110,
      bottom: 60,
      width: 100,
      height: 40,
    });
    assert.equal(card.offsetWidth, 100);
    assert.equal(card.clientHeight, 40);
    assert.equal(card.scrollHeight, 40);
  });

  it('has the size of the window, on the window and on the root element', async () => {
    const app = await render(Card, {
      providers: [provideWebCompat()],
      conditions: { width: 390, height: 844, colorScheme: 'light' },
    });
    const { width, height } = app.componentRef.injector.get(Engine).viewport;
    assert.deepEqual([width, height], [390, 844]);
    assert.equal(globals.innerWidth, width);
    assert.equal(globals.innerHeight, height);
    const root = app.instance.document.documentElement;
    assert.deepEqual(root.getBoundingClientRect(), {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
    });
    assert.equal(root.clientWidth, width);
    cleanup();
    assert.equal(globals.innerWidth, undefined);
  });

  it('reports a layout to a ResizeObserver until it is disconnected', async () => {
    const { card } = await mount();
    const seen: Dom[] = [];
    const observer = new globals.ResizeObserver((entries: Dom[]) => seen.push(...entries));
    observer.observe(card);
    await fireEvent.layout(screen.getByTestId('card'), { width: 30, height: 12 });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].target, card);
    assert.deepEqual(seen[0].contentRect, { width: 30, height: 12 });
    assert.deepEqual(seen[0].borderBoxSize, [{ inlineSize: 30, blockSize: 12 }]);
    observer.disconnect();
    await fireEvent.layout(screen.getByTestId('card'), { width: 31, height: 12 });
    assert.equal(seen.length, 1);
  });

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

  it('leaves the global document to the apps still up, in whatever order they go', async () => {
    const before = globals.document;
    const one = await render(Card, { providers: [provideWebCompat()] });
    const two = await render(Card, { providers: [provideWebCompat()] });
    assert.equal(globals.document, two.instance.document);
    one.unmount();
    assert.equal(globals.document, two.instance.document);
    two.unmount();
    assert.equal(globals.document, before);
  });

  it('takes its globals away with the last app', async () => {
    const before = globals.document;
    await mount();
    assert.equal(typeof globals.matchMedia, 'function');
    for (const name of ['scroll', 'scrollTo', 'scrollBy']) {
      assert.equal(typeof globals[name], 'function', name);
    }
    assert.equal(typeof globals.ResizeObserver, 'function');
    cleanup();
    assert.equal(globals.document, before);
    assert.equal(globals.matchMedia, undefined);
    assert.equal(globals.ResizeObserver, undefined);
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
  selector: 'x-table',
  template: `
    <form>
      <fieldset><legend>Sums</legend></fieldset>
      <table>
        <caption>
          Invoices
        </caption>
        <thead>
          <tr>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td testID="cell">$250.00</td>
          </tr>
        </tbody>
        <tfoot></tfoot>
      </table>
    </form>
    <hr />
  `,
})
class Table {}

/** A component of an app's or a library's own, whose host is a custom element. */
@Component({ selector: 'x-custom', template: '' })
class Custom {}

@Component({
  selector: 'x-positions',
  imports: [Custom, View],
  template: `
    <div testID="div"><span testID="span">text</span></div>
    <x-custom testID="custom"></x-custom>
    <div testID="placed" style="position: relative"></div>
    <view testID="view"></view>
    <table>
      <tbody>
        <tr testID="row">
          <th testID="heading">Total</th>
          <td testID="data">1</td>
        </tr>
      </tbody>
    </table>
  `,
})
class Positions {}

describe('@ng-native/web-compat element defaults', () => {
  const style = (id: string) => screen.getByTestId(id).props;

  it('starts an HTML element and a custom element static, as a browser does', async () => {
    // An absolute element is then placed against the nearest element that says `relative`,
    // where a native view is that for everything inside it.
    await render(Positions, { providers: [provideWebCompat()] });
    for (const id of ['div', 'span', 'custom', 'row', 'data']) {
      assert.equal(style(id)['position'], 'static', id);
    }
  });

  it("leaves a position the element is given, and the engine's own views", async () => {
    await render(Positions, { providers: [provideWebCompat()] });
    assert.equal(style('placed')['position'], 'relative');
    assert.equal(style('view')['position'], undefined);
  });

  it('lays a table row out as a row of cells of one width', async () => {
    await render(Positions, { providers: [provideWebCompat()] });
    assert.equal(style('row')['flexDirection'], 'row');
    for (const id of ['heading', 'data']) {
      assert.equal(style(id)['flexGrow'], 1, id);
      assert.equal(style(id)['flexBasis'], '0%', id);
      assert.equal(style(id)['justifyContent'], 'center', id);
    }
  });

  it('gives none of it to an app that did not ask for the package', async () => {
    const error = console.error;
    console.error = () => {};
    try {
      await render(Positions);
    } finally {
      console.error = error;
    }
    assert.equal(style('div')['position'], undefined);
    assert.equal(style('custom')['position'], undefined);
  });
});

describe('@ng-native/web-compat elements', () => {
  /** What the engine reports while `run` renders, an unknown element among it. */
  const reported = async (run: () => Promise<unknown>) => {
    const { error } = console;
    const seen: string[] = [];
    console.error = (message: unknown) => void seen.push(String(message));
    try {
      await run();
    } finally {
      console.error = error;
    }
    return seen.filter((message) => /not a known element/.test(message));
  };

  it('knows a button and a link, each a view with its role, which a binding replaces', async () => {
    const unknown = await reported(() => render(Links, { providers: [provideWebCompat()] }));
    assert.deepEqual(unknown, []);
    const button = screen.getByTestId('button');
    assert.equal(button.viewName, 'View');
    assert.equal(button.props['accessibilityRole'], 'button');
    assert.equal(button.props['accessible'], true);
    assert.equal(screen.getByTestId('link').props['role'], 'tab');
    assert.equal(button.props['focusable'], true);
  });

  it('knows the elements of a table and a form, each a plain view', async () => {
    const unknown = await reported(() => render(Table, { providers: [provideWebCompat()] }));
    assert.deepEqual(unknown, []);
    assert.equal(screen.getByTestId('cell').viewName, 'View');
    assert.ok(screen.getByText('Total'));
    cleanup();
    const without = await reported(() => render(Table));
    assert.match(without.join('\n'), /<table> is not a known element/, 'only where asked for');
  });

  it('announces a disabled button as disabled, beside its other states, until it is enabled', async () => {
    const app = await render(Links, { providers: [provideWebCompat()] });
    const state = () => screen.getByTestId('off').props['accessibilityState'];
    assert.deepEqual(state(), { disabled: true, expanded: true });
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

  it('leaves them unknown to an app that did not ask, and after the one that did', async () => {
    await render(Links, { providers: [provideWebCompat()] });
    cleanup();
    const unknown = await reported(() => render(Links));
    assert.equal(unknown.length, 2);
    assert.equal(screen.getByTestId('button').props['accessibilityRole'], undefined);
  });
});

@Component({
  selector: 'x-fields',
  template: `
    <input
      testID="name"
      placeholder="Name"
      [value]="value()"
      (input)="typed.set($any($event.target).value)"
      (change)="changed.set($any($event.target).value)"
    />
    <input testID="secret" type="password" />
    <input testID="mail" [type]="kind()" />
    <input testID="off" [disabled]="off()" />
    <input testID="fixed" readonly maxlength="5" />
    <textarea testID="long"></textarea>
    <input testID="radio" type="radio" value="a" />
    <input testID="check" type="checkbox" />
    <input testID="code" [inputMode]="mode()" autocomplete="one-time-code" />
    <input testID="padded" style="padding-top: 6px" />
  `,
})
class Fields {
  readonly mode = signal<string | null>('numeric');
  readonly value = signal('Ada');
  readonly typed = signal('');
  readonly changed = signal('');
  readonly kind = signal('email');
  readonly off = signal(true);
}

@Component({
  selector: 'x-panels',
  template: `
    <div testID="shown" [hidden]="false" style="opacity: 0.5">One</div>
    <div testID="gone" [hidden]="gone()" style="opacity: 0.5">Two</div>
    <div testID="static" hidden>Three</div>
    <span testID="label" [textContent]="label()"></span>
  `,
})
class Panels {
  readonly gone = signal(true);
  readonly label = signal<string | null>('Apple');
}

describe('@ng-native/web-compat location', () => {
  it('gives Angular a Location in an app with no router', async () => {
    const { app } = await mount();
    const location = app.componentRef.injector.get(Location);
    assert.equal(location.path(), '');
    const stop = location.onUrlChange(() => {});
    stop();
  });
});

describe('@ng-native/web-compat hidden', () => {
  it('takes a hidden element out of the layout, and puts it back', async () => {
    const app = await render(Panels, { providers: [provideWebCompat()] });
    const hidden = { includeHiddenElements: true };
    assert.equal(screen.getByTestId('shown').props['display'] ?? null, null);
    assert.equal(screen.queryByTestId('gone'), null, 'not there for anyone to find');
    assert.equal(screen.getByTestId('gone', hidden).props['display'], 'none');
    assert.equal(screen.getByTestId('static', hidden).props['display'], 'none');
    assert.equal(screen.getByTestId('gone', hidden).props['opacity'], 0.5, 'its own style stays');
    app.instance.gone.set(false);
    await settle();
    assert.equal(screen.getByTestId('gone').props['display'] ?? null, null);
    assert.equal(screen.getByTestId('gone').props['opacity'], 0.5);
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
  const thumb = () => screen.getByTestId('thumb').props;
  const none = (key: string) => assert.equal(thumb()[key] ?? null, null, key);

  it('sets a logical inset as the side the view reads, and a shorthand as both', async () => {
    await render(Insets, { providers: [provideWebCompat()] });
    assert.equal(thumb()['top'], 0);
    assert.equal(thumb()['bottom'], '70%');
    assert.equal(thumb()['end'], 12, 'from a style attribute too');
    for (const key of ['insetInlineStart', 'insetBlock', 'insetInlineEnd']) none(key);
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
    assert.equal(thumb()['insetInlineStart'], 'calc(30% + 4.5px)');
    none('start');
  });
});

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

describe('@ng-native/web-compat pointer events', () => {
  const finger = (pageX: number, pageY: number, down = true) => {
    const point = { identifier: 0, pageX, pageY, locationX: 0, locationY: 0 };
    return { ...point, touches: down ? [point] : [], changedTouches: [point] };
  };

  it('delivers a touch as pointer events at the finger, captured until it lifts', async () => {
    const app = await render(Drag, { providers: [provideWebCompat()] });
    const track = screen.getByTestId('track');
    await fireEvent(track, 'touchStart', finger(10, 5));
    await fireEvent(track, 'touchMove', finger(60, 5));
    await fireEvent(track, 'touchMove', finger(90, 8));
    const node = app.componentRef.location.nativeElement.children[0];
    assert.equal(node.hasPointerCapture(0), true);
    await fireEvent(track, 'touchEnd', finger(90, 8, false));
    assert.deepEqual(app.instance.seen, [
      'pointerdown 10,5 captured',
      'pointermove 60,5 captured',
      'pointermove 90,8 captured',
      'pointerup 90,8 captured',
      'click',
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

  it('delivers no context menu for a press, nor for a finger that moves away', async () => {
    const app = await render(Held, { providers: [provideWebCompat()] });
    const area = screen.getByTestId('area');
    await userEvent.press(area);
    assert.equal(app.instance.clicks(), 1);
    await fireEvent(area, 'touchStart', finger(40, 60));
    await fireEvent(area, 'touchMove', finger(80, 60));
    await new Promise((resolve) => setTimeout(resolve, 550));
    await fireEvent(area, 'touchEnd', finger(80, 60, false));
    assert.equal(app.instance.menus.length, 0);
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
    const node = app.componentRef.location.nativeElement.children[0];
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
});

describe('@ng-native/web-compat markup', () => {
  it('hands an icon component an empty box for the markup it sets, and sends none of it', async () => {
    const { app, card } = await mount();
    const renderer = app.instance.renderer;
    // What `@ng-icons/core` does with an icon's SVG.
    const template = renderer.createElement('template');
    renderer.setProperty(template, 'innerHTML', '<svg viewBox="0 0 24 24"><path d="M0 0" /></svg>');
    const svg = template.content.firstElementChild;
    renderer.appendChild(card, svg);
    await settle();
    assert.equal(template.props.innerHTML, undefined);
    assert.equal(svg.parentNode, card);
    assert.equal(template.content.firstElementChild, svg, 'the same box each time it is asked');
  });
});

describe('@ng-native/web-compat text fields', () => {
  const fields = () => render(Fields, { providers: [provideWebCompat()] });
  const field = (id: string) => screen.getByTestId(id);

  it('makes an input and a textarea the platform text field', async () => {
    await fields();
    assert.match(field('name').viewName, /TextInput$/);
    assert.equal(field('name').props['placeholder'], 'Name');
    assert.match(field('long').viewName, /TextInput$/);
    assert.equal(field('long').props['multiline'], true);
  });

  it('leaves an input that is not typed into a plain view', async () => {
    await fields();
    for (const id of ['radio', 'check']) {
      assert.equal(field(id).viewName, 'View', id);
      assert.equal(field(id).props['text'], undefined, id);
    }
  });

  it('shows the value it is given, and the one it is given next', async () => {
    const app = await fields();
    assert.equal(field('name').props['text'], 'Ada');
    assert.equal(field('name').props['value'], undefined);
    app.instance.value.set('Grace');
    await settle();
    assert.equal(field('name').props['text'], 'Grace');
  });

  it('reports what is typed as an input event, with the new value on its target', async () => {
    const app = await fields();
    await fireEvent.changeText(field('name'), 'Ad');
    assert.equal(app.instance.typed(), 'Ad');
    assert.equal(app.instance.changed(), '', 'not a change until the edit ends');
    await userEvent.type(field('name'), '!');
    assert.equal(app.instance.typed(), 'Ada!');
    assert.equal(globals.document.querySelector('input').value, 'Ada!');
    // Native takes the next text set from here only if it names the edit it follows.
    assert.equal(Number(field('name').props['mostRecentEventCount']) > 1, true);
    // `type` leaves the field, which is when a browser reports a change.
    assert.equal(app.instance.changed(), 'Ada!');
  });

  it('draws a field as a browser does one: no underline, and no padding but what it is given', async () => {
    // Android draws a line under a text field and pads it, which a short field clips its text on.
    await fields();
    assert.equal(field('name').props['underlineColorAndroid'], 'transparent');
    assert.equal(field('name').props['paddingTop'], 0);
    assert.equal(field('name').props['paddingBottom'], 0);
    assert.equal(field('long').props['underlineColorAndroid'], 'transparent');
    assert.equal(field('padded').props['paddingTop'], 6);
    assert.equal(field('padded').props['paddingBottom'], 0);
  });

  it('reads an input mode as the keyboard, and an autocomplete as what the system offers', async () => {
    const app = await fields();
    assert.equal(field('code').props['keyboardType'], 'number-pad');
    assert.equal(field('code').props['inputMode'], undefined, 'not set as written');
    assert.equal(field('code').props['textContentType'], 'oneTimeCode');
    assert.equal(field('code').props['autoComplete'], 'sms-otp');
    app.instance.mode.set('decimal');
    await settle();
    assert.equal(field('code').props['keyboardType'], 'decimal-pad');
    app.instance.mode.set(null);
    await settle();
    assert.equal(field('code').props['keyboardType'] ?? null, null);
  });

  it('reads a type as the keyboard and entry it stands for, and follows it changing', async () => {
    const app = await fields();
    assert.equal(field('secret').props['secureTextEntry'], true);
    assert.equal(field('mail').props['keyboardType'], 'email-address');
    assert.equal(field('mail').props['autoCapitalize'], 'none');
    app.instance.kind.set('tel');
    await settle();
    assert.equal(field('mail').props['keyboardType'], 'phone-pad');
    assert.equal(field('mail').props['autoCapitalize'] ?? null, null);
    app.instance.kind.set('text');
    await settle();
    assert.equal(field('mail').props['keyboardType'] ?? null, null);
  });

  it('cannot be edited when disabled or read-only, and can again once it is not', async () => {
    const app = await fields();
    assert.equal(field('off').props['editable'], false);
    assert.equal(field('fixed').props['editable'], false);
    assert.equal(field('fixed').props['maxLength'], 5);
    app.instance.off.set(false);
    await settle();
    assert.equal(field('off').props['editable'] ?? null, null);
  });

  it('is an unknown element again for an app that did not ask', async () => {
    await fields();
    cleanup();
    await render(Fields);
    assert.equal(field('name').viewName, 'View');
    assert.equal(field('name').props['text'], undefined);
  });
});

@Component({
  selector: 'x-labelled',
  template: `
    <label testID="label" for="name">Full name</label>
    <input testID="name" id="name" />
    <label for="named">Other</label>
    <input testID="named" id="named" aria-label="Already named" />
  `,
})
class Labelled {}

describe('@ng-native/web-compat labels', () => {
  it('names the control a label is for, unless it has a name of its own', async () => {
    await render(Labelled, { providers: [provideWebCompat()] });
    await settle();
    assert.equal(screen.getByTestId('name').props['accessibilityLabel'], 'Full name');
    assert.equal(screen.getByTestId('named').props['accessibilityLabel'], 'Already named');
  });

  it('focuses the control when its label is pressed', async () => {
    const app = await render(Labelled, { providers: [provideWebCompat()] });
    await settle();
    await userEvent.press(screen.getByTestId('label'));
    assert.deepEqual(
      app.fabric.commands.map((command) => [command.name, command.node?.props['testID']]),
      [['focus', 'name']],
    );
  });
});
