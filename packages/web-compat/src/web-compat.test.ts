/**
 * `@ng-native/web-compat`: engine nodes answering to the DOM members a component library written
 * for the browser calls, each one going through the engine's own mutation API.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Location } from '@angular/common';
import { Component, DOCUMENT, ElementRef, Renderer2, inject, signal } from '@angular/core';
import { Text, View } from '@ng-native/components';
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

  it('listens on the body for the renderer', async () => {
    const { app } = await mount();
    const stop = app.instance.renderer.listen('body', 'layout', () => {});
    assert.equal(app.instance.document.body.listeners.get('topLayout').size, 1);
    stop();
    assert.equal(app.instance.document.body.listeners.get('topLayout').size, 0);
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

  it('reports a layout to a ResizeObserver until it is disconnected', async () => {
    const { card } = await mount();
    const seen: Dom[] = [];
    const observer = new globals.ResizeObserver((entries: Dom[]) => seen.push(...entries));
    observer.observe(card);
    await fireEvent.layout(screen.getByTestId('card'), { width: 30, height: 12 });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].target, card);
    assert.deepEqual(seen[0].contentRect, { width: 30, height: 12 });
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
  template: `<button testID="button">Save</button><a testID="link" role="tab">More</a>`,
})
class Links {}

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
  `,
})
class Fields {
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
  `,
})
class Panels {
  readonly gone = signal(true);
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
