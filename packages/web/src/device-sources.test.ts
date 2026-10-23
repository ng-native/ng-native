/**
 * `Screen`, answered by the browser rather than by the fallback that means "no device".
 *
 * `@ng-native/device`'s factories all degrade to doing nothing off a device, which is what
 * makes the package importable by a test suite and what made it quietly wrong here: `mount`
 * provided nothing in their place, so `Screen` reported a window of zero by zero on every page.
 *
 * `compact()` is `width < 768`, so zero meant every component that branches on it took the phone
 * tree - the sidebar rendered its mobile sheet instead of its rail in a 1200pt browser window -
 * and `anchored-overlay.ts` fitted every popover against a zero-sized screen. Neither said a word.
 *
 * Found by opening the gallery, not by reading, and it could only have been found that way: the
 * tests that mount through `mount` had never asked what size the window was.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { installJsdomEnvironment } from './jsdom-env.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the device capabilities, on the web', () => {
  let screen: { window: () => { width: number; height: number }; compact: () => boolean };
  let direction: { current: () => string; rtl: () => boolean };
  let os: string;
  let doc: Document;
  let view: Window & typeof globalThis;

  before(async () => {
    const { document } = installJsdomEnvironment();
    doc = document;
    view = document.defaultView as unknown as Window & typeof globalThis;
    const [{ mount }, { DeviceApp }] = await Promise.all([
      import('./mount.ts'),
      import('./device-app.ts'),
    ]);
    const root = document.createElement('app-root');
    document.body.appendChild(root);
    const app = mount(root, DeviceApp).componentRef.instance as {
      screen: typeof screen;
      direction: typeof direction;
      os: string;
    };
    screen = app.screen;
    direction = app.direction;
    os = app.os;
    await settle();
  });

  it('reports the browser viewport, not a zero-sized one', () => {
    assert.equal(screen.window().width, view.innerWidth);
    assert.ok(screen.window().width > 0, 'a real width, which is the whole point');
  });

  it('calls a desktop-sized window roomy, so responsive components take the right branch', () => {
    // The assertion the sidebar needed. jsdom's default window is 1024 wide, which is over the
    // 768 threshold - and before this it was 0, so `compact()` was true everywhere.
    assert.ok(view.innerWidth >= 768, 'the fixture window is wider than the breakpoint');
    assert.equal(screen.compact(), false);
  });

  it('follows a resize, which is a rotation and a window drag and a devtools pane', () => {
    view.innerWidth = 400;
    view.dispatchEvent(new view.Event('resize'));
    assert.equal(screen.window().width, 400);
    assert.equal(screen.compact(), true, 'and changes its mind about the layout');
  });

  it('says the OS is the web, not the iOS the engine falls back to', () => {
    assert.equal(os, 'web');
  });

  it('reads the direction off the document, which is where a web app says it', () => {
    // Left to right until something says otherwise, the same as the native fallback. The value
    // matters beyond the paint: `anchor.ts` resolves `align: 'start'` against it, so a popover
    // opened here would land on the wrong edge if this said nothing.
    assert.equal(direction.current(), 'ltr');
    assert.equal(direction.rtl(), false);
  });

  it('follows `dir` being changed, because a language switcher does not reload the page', async () => {
    doc.documentElement.setAttribute('dir', 'rtl');
    // A `MutationObserver` delivers on a microtask, so the change lands a turn later.
    await settle();
    assert.equal(direction.current(), 'rtl');
    assert.equal(direction.rtl(), true);

    // `<body dir>` wins over `<html dir>`: it is the more specific of the two, and the one a
    // framework that cannot reach the document element writes instead.
    doc.body.setAttribute('dir', 'ltr');
    await settle();
    assert.equal(direction.current(), 'ltr');

    doc.body.removeAttribute('dir');
    doc.documentElement.removeAttribute('dir');
    await settle();
    assert.equal(direction.current(), 'ltr');
  });
});
