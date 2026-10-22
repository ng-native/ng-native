/**
 * What `provideWebCompat()` adds, and when: nothing as the package is imported, all of it while
 * an app that asked for it is up, and none of it once the last such app is destroyed.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, ElementRef, inject, signal } from '@angular/core';
import { Text, TextInput, View } from '@ng-native/components';
import { registeredViewName, viewNameOf } from '@ng-native/fabric';
import { cleanup, fireEvent, render, screen, settle, userEvent } from '@ng-native/testing';

afterEach(cleanup);

/** What a library sees of an element: loosely typed, as its own code would be against the DOM. */
type Dom = any;

@Component({
  selector: 'x-clicks',
  imports: [Text, View],
  template: `<view testID="box" (click)="clicks.set(clicks() + 1)"
      ><text>{{ clicks() }}</text></view
    >
    <div id="clicks"></div>
    <button id="pressed"></button>`,
})
class Clicks {
  readonly host: Dom = inject(ElementRef).nativeElement;
  readonly document: Dom = inject(DOCUMENT);
  readonly clicks = signal(0);
}

@Component({ selector: 'x-page', imports: [View], template: '<view testID="page"></view>' })
class Page {
  readonly host: Dom = inject(ElementRef).nativeElement;
  readonly document: Dom = inject(DOCUMENT);
}

@Component({
  selector: 'x-buttons',
  template: `<button testID="off" disabled>Off</button><button testID="on">On</button>`,
})
class Buttons {
  readonly host: Dom = inject(ElementRef).nativeElement;
}

@Component({
  selector: 'x-inset',
  template: `<div testID="inset" [style.inset-inline-start]="'4px'"></div>`,
})
class Inset {}

@Component({
  selector: 'x-plain-fields',
  imports: [TextInput],
  template: `<text-input testID="plain-field" /><input testID="plain-input" />`,
})
class PlainFields {}

@Component({ selector: 'x-asking-fields', template: '<input testID="asked-field" />' })
class AskingFields {}

@Component({
  selector: 'x-drawn',
  template: `<svg testID="root" viewBox="0 0 2 2"><text testID="label" x="1">Hi</text></svg>`,
})
class Drawn {}

@Component({
  selector: 'x-shape',
  template: `<svg testID="drawing" viewBox="0 0 2 2"><path testID="shape" d="M0 0" /></svg>`,
})
class Shape {}

@Component({
  selector: 'x-canvas',
  template: `<canvas testID="canvas" width="20" height="10"></canvas>`,
})
class Canvas {}

/** The names a canvas's views are registered by, and the globals a script asks its drawing by. */
const CANVAS_NAMES = ['canvas', 'canvas:image', 'canvas:pattern'];
const CANVAS_GLOBALS = ['ImageData', 'CanvasRenderingContext2D', 'CanvasGradient', 'CanvasPattern'];

/** Whether the canvas of a `Canvas` app draws: its context, its views and its globals. */
async function canvasIsUp(): Promise<void> {
  assert.deepEqual(
    CANVAS_NAMES.map((name) => registeredViewName(name)),
    ['RNSVGSvgView', 'RNSVGImage', 'RNSVGPattern'],
  );
  for (const name of CANVAS_GLOBALS) assert.equal(typeof (globalThis as Dom)[name], 'function');
  const node = (globalThis as Dom).document.querySelector('canvas');
  const context = node.getContext('2d');
  assert.ok(context instanceof (globalThis as Dom).CanvasRenderingContext2D);
  assert.equal(node.width, 20);
  context.fillRect(0, 0, 5, 5);
  await settle();
  const view = screen.getByTestId('canvas');
  assert.deepEqual([view.props['vbWidth'], view.props['vbHeight']], [20, 10]);
  assert.equal(view.children[0]!.children[0]!.viewName, 'RNSVGPath');
  assert.deepEqual([...context.getImageData(0, 0, 1, 1).data], [0, 0, 0, 255]);
}

@Component({
  selector: 'x-framed',
  template: '<iframe src="https://video.example/embed"></iframe>',
})
class Framed {
  readonly host: Dom = inject(ElementRef).nativeElement;
}

/** What an engine's children are changed by, which an app with an iframe watches. */
const WATCHED = ['appendChild', 'insertBefore', 'removeChild'] as const;

/** The package, read the first time a test asks for it: see the first test. */
const load = () => import('./index.ts');

/** The globals there are, each as it is defined, to compare after. */
function globalsNow(): Map<string, PropertyDescriptor | undefined> {
  const names = [...Object.getOwnPropertyNames(globalThis), 'document', 'window', 'Node'];
  return new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
}

/** The members every engine node has on the prototype they share. */
const membersOf = (node: object): string[] =>
  Object.getOwnPropertyNames(Object.getPrototypeOf(node)).sort();

/** That a node answers no member it did not have before the package: one of an app that did not ask. */
function answersNoneBut(node: Dom, before: readonly string[]): void {
  for (const name of membersOf(node)) {
    // Nothing, or what any object has from further up, as `toString`.
    if (!before.includes(name)) assert.equal(node[name], (Object.prototype as Dom)[name], name);
  }
}

/** Whether a press on the box of a `Clicks` app is heard as its `(click)`. */
async function pressHeard(): Promise<boolean> {
  await userEvent.press(screen.getByTestId('box'));
  return screen.queryByText('1') !== null;
}

describe('provideWebCompat', () => {
  it('adds nothing as the package is imported', async () => {
    const plain = await render(Page);
    const members = membersOf(plain.instance.host);
    const globals = globalsNow();
    const { provideWebCompat } = await load();
    assert.equal(typeof provideWebCompat, 'function');
    assert.deepEqual(globalsNow(), globals, 'no global defined or replaced');
    assert.deepEqual(membersOf(plain.instance.host), members, 'no member on the nodes');
    cleanup();
    // And no renderer extension: a `(click)` on a view is not a press.
    await render(Clicks);
    assert.equal(await pressHeard(), false);
    assert.equal((globalThis as Dom).window, undefined);
  });

  it('adds its members, globals and listeners while the app is up, and takes them all away after', async () => {
    const { provideWebCompat } = await load();
    const members = membersOf((await render(Page)).instance.host);
    cleanup();
    const globals = globalsNow();
    const windowPrototype = Object.getPrototypeOf(globalThis);
    const buttonView = registeredViewName('button');
    const inputView = registeredViewName('input');
    // The engine's own, which `@defer (on viewport)` is given by the platform.
    const engineObserver = (globalThis as Dom).IntersectionObserver;

    const app = await render(Clicks, { providers: [provideWebCompat()] });
    const host = app.instance.host;
    const listened: string[] = [];
    globalThis.addEventListener('picked', () => void listened.push('window'));
    assert.equal(typeof host.getAttribute, 'function');
    assert.equal(typeof host.classList.add, 'function');
    assert.equal((globalThis as Dom).window, globalThis);
    assert.equal((globalThis as Dom).document, app.instance.document);
    assert.equal(typeof (globalThis as Dom).HTMLElement, 'function');
    assert.equal((globalThis as Dom).Node.ELEMENT_NODE, 1);
    assert.equal(typeof (globalThis as Dom).innerWidth, 'number');
    // The tree: its live lists, its observer and its walks, and the document as a node.
    const tree = ['MutationObserver', 'NodeList', 'HTMLCollection', 'TreeWalker', 'NodeFilter'];
    for (const name of [...tree, 'Text', 'DocumentFragment', 'DocumentType']) {
      assert.equal(typeof (globalThis as Dom)[name], name === 'NodeFilter' ? 'object' : 'function');
    }
    const children = host.childNodes;
    assert.equal(children.length, host.childList.length);
    assert.equal(typeof host.cloneNode, 'function');
    assert.equal(app.instance.document.doctype.parentNode, app.instance.document);
    const observer = new (globalThis as Dom).MutationObserver(() => {});
    observer.observe(host, { childList: true, subtree: true });
    assert.equal(await pressHeard(), true);
    // HTML: markup, names, attributes as nodes, what HTML reflects, and the elements it has.
    const html = ['DOMParser', 'XMLSerializer', 'Attr', 'Document', 'HTMLDivElement'];
    for (const name of [...html, 'DOMStringMap', 'ProcessingInstruction']) {
      assert.equal(typeof (globalThis as Dom)[name], 'function', name);
    }
    const div = host.lastElementChild.previousElementSibling;
    assert.equal(div.outerHTML, '<div id="clicks"></div>');
    assert.equal(div.namespaceURI, 'http://www.w3.org/1999/xhtml');
    assert.equal(div.title, '');
    assert.equal(typeof div.dataset, 'object');
    assert.equal(div.attributes.length, 1);
    assert.equal(typeof app.instance.document.implementation.createHTMLDocument, 'function');
    assert.equal((globalThis as Dom).clicks, div, 'an element with an id is a global by it');
    assert.equal(registeredViewName('button'), 'View');
    assert.equal(host.lastElementChild.props['accessibilityRole'], 'button');
    // Selectors: what an element matches, and what is under it and the document that does.
    const selectors = ['matches', 'webkitMatchesSelector', 'closest'];
    for (const name of [...selectors, 'querySelector', 'querySelectorAll']) {
      assert.equal(typeof host[name], 'function', name);
    }
    assert.equal(host.querySelector('#clicks'), div);
    assert.equal(div.matches('#clicks'), true);
    assert.equal(app.instance.document.querySelector('#pressed'), host.lastElementChild);
    // CSSOM: sheets and their rules, inline and computed style, and the `CSS` namespace.
    const cssom = ['CSSStyleSheet', 'CSSRule', 'CSSRuleList', 'CSSStyleRule', 'StyleSheet'];
    for (const name of [...cssom, 'CSSStyleDeclaration', 'MediaList', 'getComputedStyle']) {
      assert.equal(typeof (globalThis as Dom)[name], 'function', name);
    }
    assert.equal(typeof (globalThis as Dom).CSS.supports, 'function');
    div.style.width = '10px';
    assert.equal(div.style.width, '10px');
    // Over the runtime's own, which answers nothing.
    assert.equal((globalThis as Dom).getComputedStyle(div).width, '10px');
    const style = app.instance.document.createElement('style');
    style.textContent = '#pressed { width: 5px }';
    app.instance.document.head.appendChild(style);
    assert.equal(app.instance.document.styleSheets.length, 1);
    assert.equal(style.sheet.cssRules.length, 1);
    geometryIsUp(app, host, div, engineObserver);
    eventsAreUp(app, div);
    const input = formsAreUp(app);
    // The page's address, and its frames: each a document of its own here, with no web view.
    const page = ['location', 'frames', 'postMessage'];
    assert.equal((globalThis as Dom).location.href, 'app:///');
    assert.equal(app.instance.document.URL, 'app:///');
    const engine = host.engine;
    const unwatched = WATCHED.map((name) => engine[name]);
    const iframe = app.instance.document.createElement('iframe');
    app.instance.document.body.appendChild(iframe);
    assert.equal((globalThis as Dom).frames.length, 1);
    assert.equal(iframe.contentWindow.parent, globalThis);
    assert.notDeepEqual(
      WATCHED.map((name) => engine[name]),
      unwatched,
      'the engine watched for iframes',
    );

    cleanup();
    for (const name of page) assert.equal((globalThis as Dom)[name], undefined, name);
    // Unwatched again: an iframe the engine puts in the page is opened as no frame.
    const late = engine.createElement('iframe');
    engine.appendChild(engine.root, late);
    const { contentWindowOf } = await import('./frame.ts');
    assert.equal(contentWindowOf(late), null);
    assert.deepEqual(globalsNow(), globals, 'every global as it was, the document too');
    // A node of the app that went still answers, as an element out of the document does in a
    // browser: a library's late timer has something to call.
    assert.equal(typeof host.getAttribute, 'function');
    assert.equal(typeof host.classList.add, 'function');
    // A node of an app that did not ask has none of it, as it had none before.
    const again = await render(Clicks);
    const plainHost = again.instance.host;
    // By the engine's own list: the node has no `lastElementChild` of the package's.
    const plainDiv = plainHost.childList.find((node: Dom) => node.tag === 'div');
    answersNoneBut(plainHost, members);
    // The runtime's own `getComputedStyle` is back, which the comparison above says.
    const gone = [
      ...tree,
      ...html,
      ...cssom,
      'CSS',
      'MediaList',
      ...GEOMETRY_GLOBALS,
      ...FORM_GLOBALS,
    ];
    for (const name of gone) {
      assert.equal((globalThis as Dom)[name], undefined, name);
    }
    assert.equal((globalThis as Dom).IntersectionObserver, engineObserver);
    assert.deepEqual(
      [(globalThis as Dom).screen, (globalThis as Dom).screenX],
      [undefined, undefined],
    );
    for (const name of [...PLACED, 'offsetWidth', 'scrollTop']) {
      assert.equal(plainDiv[name], undefined, name);
    }
    assert.equal(plainDiv.style, undefined);
    // The app's own `<style>`, out of any document now, has no sheet, as a browser's has none.
    assert.equal(style.sheet, null);
    assert.deepEqual(
      [plainHost.childNodes, plainHost.cloneNode, plainHost.append],
      [undefined, undefined, undefined],
    );
    assert.deepEqual(
      [
        plainDiv.innerHTML,
        plainDiv.namespaceURI,
        plainDiv.title,
        plainDiv.dataset,
        plainDiv.attributes,
      ],
      [undefined, undefined, undefined, undefined, undefined],
    );
    for (const name of [...selectors, 'querySelector', 'querySelectorAll']) {
      assert.equal(plainHost[name], undefined, name);
    }
    assert.equal(Object.getPrototypeOf(globalThis), windowPrototype, 'no named properties');
    for (const name of EVENT_GLOBALS) {
      assert.equal((globalThis as Dom)[name], undefined, name);
    }
    assert.equal('event' in globalThis, false);
    assert.equal((Event.prototype as Dom).AT_TARGET, undefined, "on Node's `Event` alone again");
    for (const name of ['onclick', 'onload', 'blur', 'click'])
      assert.equal(plainDiv[name], undefined);
    assert.equal((globalThis as Dom).clicks, undefined);
    assert.equal(registeredViewName('button'), buttonView);
    formsAreDown(input, inputView);
    // The engine's own, which has no more than `contains`.
    assert.equal(plainHost.classList.add, undefined);
    // The window's listeners went with it, and the renderer's extension.
    assert.equal(plainHost.getAttribute, undefined);
    assert.equal(again.instance.host.childList.at(-1).props['accessibilityRole'], undefined);
    assert.equal(await pressHeard(), false);
    cleanup();
    await render(Page, { providers: [provideWebCompat()] });
    globalThis.dispatchEvent(new Event('picked'));
    assert.deepEqual(listened, []);
  });

  it('draws an svg while the app is up, and takes the names it gave its elements away after', async () => {
    const { provideWebCompat } = await load();
    const names = ['svg', 'path', 'svg:text', 'svg:tspan', 'svg:undrawn'];
    const before = names.map((name) => registeredViewName(name));
    await render(Drawn);
    const plain = [screen.getByTestId('root').viewName, screen.getByTestId('label').viewName];
    cleanup();

    await render(Drawn, { providers: [provideWebCompat()] });
    const label: Dom = screen.getByTestId('label');
    assert.deepEqual(
      [screen.getByTestId('root').viewName, label.viewName, label.children[0].viewName],
      ['RNSVGSvgView', 'RNSVGText', 'RNSVGTSpan'],
    );
    const element = label.instanceHandle;
    assert.deepEqual(
      [element.tagName, element.namespaceURI, element.className.baseVal],
      ['text', 'http://www.w3.org/2000/svg', ''],
    );
    assert.equal(registeredViewName('path'), 'RNSVGPath');

    cleanup();
    assert.deepEqual(
      names.map((name) => registeredViewName(name)),
      before,
      'every name as it was',
    );
    assert.deepEqual(
      before,
      names.map(() => undefined),
      'none of them a name before',
    );
    // And the renderer names an element in an `<svg>` as it is written again.
    await render(Drawn);
    assert.deepEqual(
      [screen.getByTestId('root').viewName, screen.getByTestId('label').viewName],
      plain,
    );
  });

  it('draws on a canvas while the app is up, and takes its names and globals away after', async () => {
    const { provideWebCompat } = await load();
    const before = CANVAS_NAMES.map((name) => registeredViewName(name));
    await render(Canvas);
    const plain = screen.getByTestId('canvas').viewName;
    cleanup();

    await render(Canvas, { providers: [provideWebCompat()] });
    const node: Dom = screen.getByTestId('canvas').instanceHandle;
    await canvasIsUp();

    cleanup();
    assert.deepEqual(
      CANVAS_NAMES.map((name) => registeredViewName(name)),
      before,
      'every name as it was',
    );
    assert.deepEqual(before, [undefined, undefined, undefined], 'none of them a name before');
    for (const name of CANVAS_GLOBALS) assert.equal((globalThis as Dom)[name], undefined, name);
    // The app's canvas still answers, as a browser's out of the document does.
    assert.equal(typeof node.getContext, 'function');
    // And a canvas is what the renderer makes of one again, with nothing drawn in it.
    await render(Canvas);
    assert.equal(screen.getByTestId('canvas').viewName, plain);
    assert.deepEqual(screen.getByTestId('canvas').children, []);
    const plainNode: Dom = screen.getByTestId('canvas').instanceHandle;
    assert.deepEqual(
      [plainNode.getContext, plainNode.toDataURL, plainNode.toBlob],
      [undefined, undefined, undefined],
    );
  });

  it("leaves a runtime's own ImageData as it is, while the app is up and after", async () => {
    const { provideWebCompat } = await load();
    class OwnImageData {}
    const globals = globalThis as Dom;
    globals.ImageData = OwnImageData;
    try {
      await render(Canvas, { providers: [provideWebCompat()] });
      assert.equal(globals.ImageData, OwnImageData);
      cleanup();
      assert.equal(globals.ImageData, OwnImageData);
    } finally {
      delete globals.ImageData;
    }
  });

  it('still answers for a node of an app that is gone, and not for one of an app that did not ask', async () => {
    // A library's timer fires after its app is torn down: a ripple that fades, a class a field
    // adds. An element out of the document still answers in a browser, and here.
    const { provideWebCompat } = await load();
    const host = (await render(Page, { providers: [provideWebCompat()] })).instance.host;
    cleanup();
    assert.equal(typeof host.getAttribute, 'function');
    host.classList.add('late');
    assert.equal(host.classList.contains('late'), true);
    const plain = (await render(Page)).instance.host;
    assert.equal(plain.getAttribute, undefined);
    // The engine's own, which has no more than `contains`.
    assert.equal(plain.classList.add, undefined);
    // And what it has from further up, as any object has it.
    assert.equal(String(plain), '[object Object]');
    // A member that is only read is not written over, as a browser's is not.
    host.nodeName = 'X';
    assert.equal(host.nodeName, 'X-PAGE');
    assert.equal(Object.hasOwn(host, 'nodeName'), false);
    cleanup();
    // And for an app that asks after one that did not, as it did the first time.
    const again = (await render(Page, { providers: [provideWebCompat()] })).instance.host;
    assert.equal(typeof again.getAttribute, 'function');
    assert.equal(typeof again.classList.add, 'function');
  });

  it('stays while any app that asked for it is up, and gives the document to the newest', async () => {
    const { provideWebCompat } = await load();
    const before = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const one = await render(Page, { providers: [provideWebCompat()] });
    const two = await render(Page, { providers: [provideWebCompat()] });
    assert.equal((globalThis as Dom).document, two.instance.document);
    two.unmount();
    assert.equal((globalThis as Dom).document, one.instance.document);
    assert.equal(typeof one.instance.host.getAttribute, 'function');
    one.unmount();
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'document'), before);
    // Gone, its nodes still answer: see the test above.
    assert.equal(typeof one.instance.host.getAttribute, 'function');
  });

  it('changes nothing in an app that did not ask, while one that did is up', async () => {
    const { provideWebCompat } = await load();
    await render(Page, { providers: [provideWebCompat()] });
    const plain = await render(Clicks);
    assert.equal(await pressHeard(), false);
    // Its attributes are the props they are written as: an id is no native id.
    const box = plain.instance.host.lastElementChild.previousElementSibling;
    assert.deepEqual([box.props['id'], box.props['nativeID']], ['clicks', undefined]);
    assert.equal(box.ownerDocument, null);
    // What overflows its elements is laid out as it is without the package: none scrolls.
    assert.equal(box.scrollsOverflow, undefined);
    // An element of it watched for being in sight is watched by the engine's own observer, which
    // hears none of its commits.
    plain.fabric.frames.set(String(box.committed.viewName), { x: 0, y: 0, width: 5, height: 5 });
    const seen: Dom[] = [];
    const observer = new (globalThis as Dom).IntersectionObserver(function (
      this: unknown,
      entries: Dom[],
    ) {
      seen.push(this, ...entries);
    });
    observer.observe(box);
    await Promise.resolve();
    assert.equal(Object.hasOwn(box.engine, 'commit'), false);
    assert.equal(seen[0] === observer && seen[1].target === box, true);
    assert.equal(seen[1].isIntersecting, true);
    observer.disconnect();
    // Its button has no role given it, and its element with an id is no global.
    assert.equal(plain.instance.host.lastElementChild.props['accessibilityRole'], undefined);
    assert.equal((globalThis as Dom).clicks, undefined);
    // A disabled button is not announced, and no button takes a press or marks a hover.
    const buttons = await render(Buttons);
    const off = screen.getByTestId('off');
    assert.equal(off.props['aria-disabled'], undefined);
    assert.equal(off.props['accessibilityState'], undefined);
    await fireEvent(screen.getByTestId('on'), 'topPointerEnter');
    assert.equal(screen.getByTestId('on').props['data-hover'], undefined);
    await fireEvent(screen.getByTestId('on'), 'touchStart', {
      identifier: 0,
      pageX: 1,
      pageY: 1,
      touches: [{ identifier: 0, pageX: 1, pageY: 1 }],
      changedTouches: [{ identifier: 0, pageX: 1, pageY: 1 }],
    });
    assert.equal(buttons.instance.host.childList[1].active, undefined, 'no press taken');

    // A drawing's attributes are the props they are written as, and a shape has no fill given it.
    await render(Shape);
    assert.equal(screen.getByTestId('drawing').props['viewBox'], '0 0 2 2');
    assert.equal(screen.getByTestId('shape').props['fill'], undefined);
    // A canvas is given no group to draw in and no grid, and has no context to draw with.
    await render(Canvas);
    const canvas = screen.getByTestId('canvas');
    assert.deepEqual(canvas.children, []);
    assert.deepEqual([canvas.props['width'], canvas.props['vbWidth']], ['20', undefined]);
    assert.equal((canvas.instanceHandle as Dom).getContext('2d'), null);
    // A style it binds is set as written, as the renderer sets one: no inset read as a side.
    await render(Inset);
    assert.equal(screen.getByTestId('inset').props['start'], undefined);
    // Its text field has none of a browser's defaults, and its `<input>` is no text field, beside
    // an asking app's that has them.
    await render(AskingFields, { providers: [provideWebCompat()] });
    assert.match(screen.getByTestId('asked-field').viewName, /TextInput$/);
    await plainFieldsAreAsThey();
  });

  it("leaves no field default on an app's text fields once the last app that asked is gone", async () => {
    const { provideWebCompat } = await load();
    await render(AskingFields, { providers: [provideWebCompat()] });
    const asked = screen.getByTestId('asked-field').props;
    assert.deepEqual([asked['paddingTop'], typeof asked['width']], [0, 'number']);
    cleanup();
    await plainFieldsAreAsThey();
  });

  it('shows an iframe as a web view in the app that asked alone, and only while it is up', async () => {
    const { provideWebCompat } = await load();
    const scope = globalThis as Dom;
    const had = Object.getOwnPropertyDescriptor(scope, '__nativeComponentRegistry__hasComponent');
    // React Native's answer on a device with react-native-webview installed.
    scope.__nativeComponentRegistry__hasComponent = (name: string) => name === 'RNCWebView';
    try {
      const before = registeredViewName('iframe');
      const asking = await render(Page, { providers: [provideWebCompat()] });
      const plain = await render(Framed);
      assert.equal(registeredViewName('iframe'), 'RNCWebView');
      const engine = plain.instance.host.engine;
      const unwatched = WATCHED.map((name) => engine[name]);
      const theirs = plain.instance.host.firstChild;
      const ours = asking.instance.document.createElement('iframe');
      asking.instance.document.body.appendChild(ours);
      await settle();
      // The plain app's is the plain view it is without the package, and nothing watches it.
      assert.equal(viewNameOf(theirs), 'View');
      assert.equal(viewNameOf(ours), 'RNCWebView');
      assert.equal(theirs.props['newSource'], undefined);
      assert.equal(theirs.props['src'], 'https://video.example/embed', 'its src a prop as written');
      assert.deepEqual(
        WATCHED.map((name) => engine[name]),
        unwatched,
      );
      cleanup();
      assert.equal(registeredViewName('iframe'), before);
    } finally {
      if (had) Object.defineProperty(scope, '__nativeComponentRegistry__hasComponent', had);
      else delete scope.__nativeComponentRegistry__hasComponent;
    }
  });

  it('adds it all again for an app that asks after the last one went', async () => {
    const { provideWebCompat } = await load();
    await render(Page, { providers: [provideWebCompat()] });
    cleanup();
    const app = await render(Clicks, { providers: [provideWebCompat()] });
    assert.equal(typeof app.instance.host.getAttribute, 'function');
    assert.equal((globalThis as Dom).window, globalThis);
    assert.equal(await pressHeard(), true);
  });
});

/** The event kinds an asking app puts on the window. */
const EVENT_GLOBALS = ['UIEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'FocusEvent'];
EVENT_GLOBALS.push('InputEvent', 'TouchEvent', 'Touch', 'WheelEvent', 'MediaQueryListEvent');

/** C6's members and globals, while an app that asked is up. */
function eventsAreUp(app: Dom, div: Dom): void {
  // Events: their kinds, `window.event`, `createEvent`, the phases on every event, a handler
  // as a property, and focus and a click from a script.
  for (const name of EVENT_GLOBALS) {
    assert.equal(typeof (globalThis as Dom)[name], 'function', name);
  }
  assert.equal('event' in globalThis, true);
  assert.equal(typeof app.instance.document.createEvent, 'function');
  assert.equal((Event.prototype as Dom).AT_TARGET, 2);
  const nodeEvents = ['onclick', 'onload', 'focus', 'blur', 'click'];
  for (const name of nodeEvents) assert.equal(name in div, true, name);
  assert.equal(div.onclick, null);
}

/** The geometry an asking app puts on the window. */
const GEOMETRY_GLOBALS = ['DOMRect', 'DOMRectReadOnly', 'DOMRectList', 'ResizeObserver'];
GEOMETRY_GLOBALS.push('ResizeObserverEntry', 'ResizeObserverSize', 'IntersectionObserverEntry');
GEOMETRY_GLOBALS.push('MediaQueryList', 'matchMedia', 'scroll', 'scrollTo', 'scrollBy');

/** The members an asking app's elements say where they are with. */
const PLACED = ['getBoundingClientRect', 'getClientRects', 'scrollIntoView', 'scrollBy'];

/** C7's members and globals, while an app that asked is up. */
function geometryIsUp(app: Dom, host: Dom, div: Dom, engineObserver: unknown): void {
  // Geometry: where an element is and how big, scrolling it, the window, media queries and the
  // observers, over the engine's own `IntersectionObserver`.
  for (const name of GEOMETRY_GLOBALS) {
    assert.equal(typeof (globalThis as Dom)[name], 'function', name);
  }
  assert.notEqual((globalThis as Dom).IntersectionObserver, engineObserver);
  assert.equal(typeof (globalThis as Dom).IntersectionObserver, 'function');
  assert.equal((globalThis as Dom).matchMedia('(min-width: 0px)').matches, true);
  assert.equal(typeof (globalThis as Dom).screen.width, 'number');
  assert.equal(typeof (globalThis as Dom).visualViewport.height, 'number');
  assert.equal((globalThis as Dom).screenX, 0);
  for (const name of PLACED) assert.equal(typeof div[name], 'function', name);
  assert.deepEqual([div.offsetWidth, div.clientHeight, div.scrollTop], [0, 0, 0]);
  assert.equal(app.instance.document.scrollingElement, host.engine.root);
  assert.equal(div.scrollsOverflow, true, 'what overflows it scrolls, where its style says');
}

/** The members a form control has while an app that asked is up. */
const CONTROL_MEMBERS = ['validity', 'checkValidity', 'setCustomValidity', 'selectionStart'];
CONTROL_MEMBERS.push('setSelectionRange', 'form', 'checked', 'value');

/** The globals of forms an asking app puts on the window. */
const FORM_GLOBALS = ['ValidityState'];

/** C8's members and globals, while an app that asked is up: answers an input it made. */
function formsAreUp(app: Dom): Dom {
  const document = app.instance.document;
  for (const name of FORM_GLOBALS) {
    assert.equal(typeof (globalThis as Dom)[name], 'function', name);
  }
  assert.match(String(registeredViewName('input')), /TextInput$/);
  const input = document.createElement('input');
  for (const name of CONTROL_MEMBERS) assert.equal(name in input, true, name);
  input.value = 'typed';
  assert.equal(input.value, 'typed');
  assert.equal(input.defaultStyle.underlineColorAndroid, 'transparent');
  assert.equal(input.validity.valid, true);
  assert.equal(document.forms.length, 0);
  return input;
}

/** A field of an app that went: its view name as it was, and its members still answering. */
function formsAreDown(input: Dom, inputView: unknown): void {
  assert.equal(registeredViewName('input'), inputView);
  for (const name of CONTROL_MEMBERS) assert.equal(name in input, true, name);
}

/**
 * What the package gives a field of an asking app, which a `<text-input>` has none of. Its
 * defaults stay with the view once given, for every app in the process, so these are asked of
 * it outright and not against one rendered earlier.
 */
const FIELD_PROPS = ['paddingTop', 'paddingBottom', 'width', 'size'];

/** The text field and the `<input>` of an app that did not ask, as the package leaves them. */
async function plainFieldsAreAsThey(): Promise<void> {
  await render(PlainFields);
  const field = screen.getByTestId('plain-field');
  assert.match(field.viewName, /TextInput$/);
  for (const prop of FIELD_PROPS) assert.equal(field.props[prop], undefined, prop);
  assert.equal(screen.getByTestId('plain-input').viewName, 'View');
}
