/**
 * `<img>`: the platform's image view, shown from its `src` resolved against the page's address,
 * said to a screen reader by its `alt`, sized by its `width` and `height` or by its picture once
 * that has loaded, fitted to its box as `object-fit` says, and an SVG drawn from its markup.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, signal } from '@angular/core';
import { registeredViewName } from '@ng-native/fabric';
import { cleanup, compileCss, fireEvent, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of an element or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({
  template: `
    <img
      testID="pic"
      [src]="src()"
      alt="A bamboo watch"
      style="width: 100%"
      (load)="seen.push('load ' + $any($event).type + ' ' + $any($event).target.naturalWidth)"
      (error)="seen.push('error ' + $any($event).type)"
    />
    <img testID="bare" src="flags/flag.png" />
    <img testID="sized" src="https://example.test/logo.png" width="40" height="20" />
    <img testID="classed" class="small" src="https://example.test/icon.png" width="40" />
  `,
})
class Pictures {
  readonly src = signal<string | null>('https://example.test/watch.jpg');
  readonly seen: string[] = [];
}

@Component({ template: '<img testID="plain" src="flag.png" alt="A flag" width="40" />' })
class Plain {}

afterEach(cleanup);

const document = (): Dom => (globalThis as Dom).document;

const SHEET = '.small { width: 10px; height: 10px; object-fit: cover }';

const pictures = async () => {
  const app = await render(Pictures, {
    providers: [provideWebCompat({ url: 'https://shop.example/orders/' })],
    globalStyles: compileCss(SHEET, 'global'),
  });
  await settle();
  const element = (id: string): Dom => document().querySelector(`[testID=${id}]`);
  return { app, element, props: (id: string) => screen.getByTestId(id).props };
};

/** Native says an image's picture has loaded, and how big it is. */
async function loaded(id: string, width: number, height: number): Promise<void> {
  await fireEvent(screen.getByTestId(id), 'load', { source: { width, height, uri: 'x' } });
  await settle();
}

/** A prop as committed: one taken away is `null` there, and is none. */
const none = (value: unknown) => value ?? undefined;

describe('an image', () => {
  it("is the platform's image, from its src resolved against the page's address", async () => {
    const { element, props } = await pictures();
    assert.equal(screen.getByTestId('pic').viewName, 'Image');
    assert.deepEqual(props('pic')['source'], [{ uri: 'https://example.test/watch.jpg' }]);
    assert.deepEqual(props('bare')['source'], [
      { uri: 'https://shop.example/orders/flags/flag.png' },
    ]);
    // Read back as written, and as the URL it is by the property.
    assert.equal(element('bare').getAttribute('src'), 'flags/flag.png');
    assert.equal(element('bare').src, 'https://shop.example/orders/flags/flag.png');
    assert.equal(none(props('bare')['src']), undefined, 'no prop native has no use for');
    element('bare').removeAttribute('src');
    await settle();
    assert.equal(none(props('bare')['source']), undefined);
    assert.equal(element('bare').getAttribute('src'), null);
  });

  it('says its alt to a screen reader, and an image with none or an empty one is passed over', async () => {
    const { element, props } = await pictures();
    assert.equal(props('pic')['accessibilityLabel'], 'A bamboo watch');
    assert.equal(props('pic')['accessible'], true);
    assert.equal(element('pic').alt, 'A bamboo watch');
    assert.notEqual(props('bare')['accessible'], true);
    element('pic').alt = '';
    await settle();
    assert.equal(none(props('pic')['accessibilityLabel']), undefined);
    assert.notEqual(props('pic')['accessible'], true);
    element('pic').alt = 'A watch';
    element('pic').removeAttribute('alt');
    await settle();
    assert.equal(none(props('pic')['accessibilityLabel']), undefined);
  });

  it('is the size of its picture once that has loaded, and keeps its shape at a width it is given', async () => {
    const { app, element, props } = await pictures();
    const bare = element('bare');
    assert.deepEqual([bare.complete, bare.naturalWidth, bare.width], [false, 0, 0]);
    await loaded('bare', 32, 24);
    assert.deepEqual([props('bare')['width'], props('bare')['height']], [32, 24]);
    assert.deepEqual([bare.complete, bare.naturalWidth, bare.naturalHeight], [true, 32, 24]);
    assert.deepEqual([bare.width, bare.height], [32, 24]);
    await loaded('pic', 600, 400);
    assert.deepEqual([props('pic')['width'], props('pic')['aspectRatio']], ['100%', 1.5]);
    // Told to a listener as a load, with its size known by then.
    assert.deepEqual(app.instance.seen, ['load load 600']);
  });

  it('knows nothing of a picture another src names until it has loaded', async () => {
    const { app, element, props } = await pictures();
    await loaded('pic', 600, 400);
    app.instance.src.set('https://example.test/band.jpg');
    await settle();
    const pic = element('pic');
    assert.deepEqual([pic.complete, pic.naturalWidth], [false, 0]);
    assert.equal(none(props('pic')['aspectRatio']), undefined);
    await loaded('pic', 100, 50);
    assert.deepEqual([pic.naturalWidth, props('pic')['aspectRatio']], [100, 2]);
    // With no src there is nothing to load: it is complete, and of no size.
    app.instance.src.set(null);
    await settle();
    assert.deepEqual([pic.complete, pic.naturalWidth], [true, 0]);
    assert.equal(none(props('pic')['source']), undefined);
  });

  it('is complete and of no size once its picture fails to load, and says so', async () => {
    const { app, element } = await pictures();
    await fireEvent(screen.getByTestId('pic'), 'error', { error: 'Not found' });
    await settle();
    assert.deepEqual([element('pic').complete, element('pic').naturalWidth], [true, 0]);
    assert.deepEqual(app.instance.seen, ['error error']);
  });

  it('is the size its width and height attributes say, under what a stylesheet says', async () => {
    const { element, props } = await pictures();
    await loaded('sized', 400, 200);
    assert.deepEqual([props('sized')['width'], props('sized')['height']], [40, 20]);
    assert.deepEqual([element('sized').width, element('sized').naturalWidth], [40, 400]);
    assert.equal(element('sized').getAttribute('width'), '40');
    // A class's size is over the attribute's.
    assert.deepEqual([props('classed')['width'], props('classed')['height']], [10, 10]);
    // A share of what it is in, and the picture's own size again once it has none.
    element('sized').setAttribute('width', '50%');
    await settle();
    assert.deepEqual([props('sized')['width'], props('sized')['height']], ['50%', 20]);
    element('sized').removeAttribute('width');
    element('sized').removeAttribute('height');
    await settle();
    assert.deepEqual([props('sized')['width'], props('sized')['height']], [400, 200]);
    assert.equal(element('sized').width, 400);
    element('sized').width = 30;
    await settle();
    assert.deepEqual([element('sized').getAttribute('width'), props('sized')['width']], ['30', 30]);
  });

  it('fills its box with its picture as a browser does, and fits it as object-fit says', async () => {
    const { props } = await pictures();
    assert.equal(props('pic')['resizeMode'], 'stretch');
    assert.equal(props('classed')['resizeMode'], 'cover');
    // What is past its box is clipped, as a covering picture is in a browser.
    assert.equal(props('classed')['overflow'], 'hidden');
  });

  it('draws a picture that is an SVG from its markup, which no image view reads', async () => {
    const DRAWING =
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="48" height="24" ' +
      'viewBox="0 0 48 24"><path d="M0 0h48v24H0z" fill="blue"/></svg>';
    const asked: string[] = [];
    const real = globalThis.fetch;
    let arrive = () => {};
    const answers: Record<string, () => Promise<unknown>> = {
      'https://example.test/finder.svg': () =>
        Promise.resolve({ ok: true, text: () => Promise.resolve(DRAWING) }),
      'https://shop.example/orders/gone.svg': () =>
        Promise.resolve({ ok: false, text: () => Promise.resolve('') }),
      // One that arrives once it is told to.
      'https://example.test/slow.svg': () =>
        new Promise((done) => {
          arrive = () => done({ ok: true, text: () => Promise.resolve(DRAWING) });
        }),
    };
    globalThis.fetch = ((url: string) => {
      asked.push(String(url));
      return answers[url]?.() ?? new Promise(() => {});
    }) as never;
    try {
      const { app, element, props } = await pictures();
      app.instance.src.set('https://example.test/finder.svg');
      await settle();
      await new Promise((done) => setTimeout(done, 5));
      await settle();
      assert.deepEqual(asked, ['https://example.test/finder.svg']);
      const pic = screen.getByTestId('pic');
      assert.equal(pic.viewName, 'View', 'a box for the drawing, where an image holds nothing');
      assert.equal(none(pic.props['source']), undefined);
      const [drawing] = pic.children;
      assert.equal(drawing?.viewName, 'RNSVGSvgView');
      assert.deepEqual(
        drawing!.children.map((child) => child.viewName),
        ['RNSVGPath'],
      );
      // As wide as it is told, and as tall as the drawing's own shape makes it.
      assert.deepEqual([props('pic')['width'], props('pic')['aspectRatio']], ['100%', 2]);
      assert.deepEqual([element('pic').naturalWidth, element('pic').complete], [48, true]);
      assert.deepEqual(app.instance.seen, ['load load 48']);
      assert.equal(element('pic').children.length, 0, 'no element of the page');
      // One that is not found is an error, and draws nothing.
      app.instance.src.set('gone.svg');
      await settle();
      await new Promise((done) => setTimeout(done, 5));
      await settle();
      assert.equal(screen.getByTestId('pic').children.length, 0);
      assert.deepEqual(app.instance.seen, ['load load 48', 'error error']);
      // One still loading when another src is set draws nothing when it comes.
      app.instance.src.set('https://example.test/slow.svg');
      await settle();
      app.instance.src.set('https://example.test/band.jpg');
      await settle();
      arrive();
      await new Promise((done) => setTimeout(done, 5));
      await settle();
      const after = screen.getByTestId('pic');
      assert.equal(after.viewName, 'Image');
      assert.equal(after.children.length, 0);
      assert.deepEqual(after.props['source'], [{ uri: 'https://example.test/band.jpg' }]);
      assert.equal(app.instance.seen.length, 2, 'and says nothing of it');
    } finally {
      globalThis.fetch = real;
    }
  });

  it('is copied with what it shows, which the copy loads for itself', async () => {
    const { element } = await pictures();
    await loaded('sized', 400, 200);
    const copy = element('sized').cloneNode();
    copy.setAttribute('testID', 'copy');
    document().body.appendChild(copy);
    await settle();
    const view = screen.getByTestId('copy');
    assert.equal(view.viewName, 'Image');
    assert.deepEqual(view.props['source'], [{ uri: 'https://example.test/logo.png' }]);
    assert.deepEqual([view.props['width'], view.props['height']], [40, 20]);
    assert.deepEqual([copy.complete, copy.naturalWidth], [false, 0]);
    await loaded('copy', 400, 200);
    assert.deepEqual([copy.complete, copy.naturalWidth], [true, 400]);
  });

  it('is the plain view it is without the package in an app that did not ask', async () => {
    await pictures();
    assert.equal(registeredViewName('img'), 'Image');
    await render(Plain);
    const plain = screen.getByTestId('plain');
    assert.equal(plain.viewName, 'View');
    assert.deepEqual([plain.props['src'], plain.props['width']], ['flag.png', '40']);
    assert.equal(plain.props['accessibilityLabel'], undefined);
    cleanup();
    assert.equal(registeredViewName('img'), undefined, 'and is no image once no app asks');
  });
});
