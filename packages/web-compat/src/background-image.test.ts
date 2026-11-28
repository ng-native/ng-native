/**
 * A box's background of one image, as Taiga UI's examples write a wallpaper behind a surface:
 * `background: url('/assets/wallpaper.jpg'); background-size: cover`. Native paints gradients
 * alone as a background, so the image is drawn as the platform's image under what the box holds.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, signal } from '@angular/core';
import {
  cleanup,
  compileCss,
  render,
  screen,
  settle,
  type FakeFabricNode,
} from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

const SHEET = `
  .wall { background: url('/assets/wall.jpg') center / cover no-repeat; padding: 8px }
  .contain { background-image: url(pic.png); background-size: contain }
  .stretch { background: url(pic.png) 0 0 / 100% 100% no-repeat }
  .tile { background-image: url(tile.png) }
  .alone { background: url(pic.png) no-repeat }
  .wall > :first-child { opacity: 0.5 }
  .pane:empty { background: url(pic.png) }
  .inset { background: url(pic.png); top: 20px; left: 4px }
  .moved { position: relative; top: 20px; background: url(pic.png) }
  .off { background-image: none }
  .bare { background: url(pic.png); background: red }
  .tinted { color: blue; background: url(pic.png) currentColor }
  .sized { background: url(pic.png) 0 0 / 20px 20px no-repeat }
`;

@Component({
  selector: 'x-walls',
  template: `
    <div testID="wall" [class.wall]="walled()"><span>Over the wall</span></div>
    <div testID="contain" class="contain"></div>
    <div testID="stretch" class="stretch"></div>
    <div testID="tile" class="tile"></div>
    <div testID="alone" class="alone"></div>
    <div testID="pane" class="pane"></div>
    <div testID="inset" class="inset"></div>
    <div testID="moved" class="moved"></div>
    <div testID="off" class="tile off"></div>
    <div testID="bare" class="bare"></div>
    <div testID="tinted" class="tinted"></div>
  `,
})
class Walls {
  readonly walled = signal(true);
}

@Component({
  selector: 'x-pair',
  template: `
    <div testID="first" [class.wall]="on()"></div>
    <div testID="second" [class.wall]="on()"></div>
  `,
})
class Pair {
  readonly on = signal(false);
}

@Component({ selector: 'x-sized', template: '<div testID="sized" class="sized"></div>' })
class Sized {}

afterEach(cleanup);

async function page() {
  const app = await render(Walls, {
    providers: [provideWebCompat({ url: 'https://example.com/app/page' })],
    globalStyles: compileCss(SHEET, 'global', { generated: true } as object) as never,
  });
  await settle();
  return app.instance;
}

const engineOf = (id: string) =>
  (globalThis as { document?: any }).document.querySelector(`[testID="${id}"]`).engine;

const imageIn = (id: string): FakeFabricNode | undefined =>
  screen.getByTestId(id).children.find((child) => child.viewName === 'Image');

describe('a background of one image', () => {
  it('is the platform image under what the box holds, from the address resolved', async () => {
    await page();
    const wall = screen.getByTestId('wall');
    const [image, words] = wall.children;
    assert.equal(image!.viewName, 'Image');
    assert.deepEqual(image!.props['source'], [{ uri: 'https://example.com/assets/wall.jpg' }]);
    assert.equal(image!.props['resizeMode'], 'cover');
    const style = image!.props as Record<string, unknown>;
    assert.deepEqual(
      [style['position'], style['top'], style['left'], style['right'], style['bottom']],
      ['absolute', 0, 0, 0, 0],
    );
    assert.equal(style['zIndex'], -2147483647, 'under a box a rule sets below the rest');
    assert.equal(words!.viewName, 'Paragraph');
    // The box holds it, and paints no key a native view does not read.
    assert.equal(wall.props['position'], 'relative');
    assert.equal(wall.props['backgroundUrl'], undefined);
  });

  it('fills the box as its size and repeat say', async () => {
    await page();
    assert.equal(imageIn('contain')!.props['resizeMode'], 'contain');
    assert.equal(imageIn('stretch')!.props['resizeMode'], 'stretch');
    assert.equal(imageIn('tile')!.props['resizeMode'], 'repeat');
    assert.equal(imageIn('alone')!.props['resizeMode'], 'center');
    // Against the page's address, as an `<img>`'s is.
    const [{ uri }] = imageIn('tile')!.props['source'] as { uri: string }[];
    assert.match(uri, /^https:\/\/example\.com\/app\/.*tile\.png$/);
  });

  it('goes once the box has no background image', async () => {
    const walls = await page();
    walls.walled.set(false);
    await settle();
    assert.equal(imageIn('wall'), undefined);
    walls.walled.set(true);
    await settle();
    assert.equal(imageIn('wall')!.props['resizeMode'], 'cover');
  });
});

describe('a background image drawn in a box', () => {
  it('is no child of the box to :empty or :first-child', async () => {
    await page();
    const before = engineOf('pane').stats.commits;
    await settle();
    await settle();
    // Drawn once, and not taken away again by :empty no longer matching.
    assert.equal(imageIn('pane')!.props['resizeMode'], 'repeat');
    assert.equal(engineOf('pane').stats.commits, before);
    const words = screen.getByTestId('wall').children[1]!;
    assert.equal(words.props['opacity'], 0.5);
  });

  it('leaves a static box static to what places it, and a relative one moved', async () => {
    await page();
    const inset = screen.getByTestId('inset').props;
    assert.deepEqual(
      [inset['position'], inset['top'], inset['left']],
      ['relative', undefined, undefined],
    );
    const moved = screen.getByTestId('moved').props;
    assert.deepEqual([moved['position'], moved['top']], ['relative', 20]);
  });

  it('goes with a later background of no url(), in another rule or the same one', async () => {
    await page();
    assert.equal(imageIn('off'), undefined);
    assert.equal(imageIn('bare'), undefined);
    assert.equal(screen.getByTestId('bare').props['backgroundColor'], 'rgb(255, 0, 0)');
  });

  it("keeps a colour of currentColor beside it as the box's colour", async () => {
    await page();
    assert.ok(imageIn('tinted'));
    assert.equal(screen.getByTestId('tinted').props['backgroundColor'], 'rgb(0, 0, 255)');
  });

  it('says where a size in points is not read', async () => {
    const said: string[] = [];
    const warn = console.warn;
    console.warn = (message: string) => void said.push(message);
    try {
      await render(Sized, {
        providers: [provideWebCompat({ url: 'https://example.com/app/page' })],
        globalStyles: compileCss(SHEET, 'global', { generated: true } as object) as never,
      });
      await settle();
    } finally {
      console.warn = warn;
    }
    assert.equal(imageIn('sized')!.props['resizeMode'], 'center');
    assert.equal(said.filter((one) => /background-size/.test(one)).length, 1, said.join('\n'));
  });
});

describe('a background image in a sheet of the app', () => {
  it('is refused, as native paints none', () => {
    const reports: string[] = [];
    compileCss('.wall { background: url(wall.jpg) }', 'app.css', {
      onUnsupported: (message: string) => reports.push(message),
    } as object);
    assert.match(reports[0] ?? '', /url\(\) is not something native can paint/);
  });

  it('is drawn in every box it comes to in one commit after the one it came in', async () => {
    const app = await render(Pair, {
      providers: [provideWebCompat({ url: 'https://example.com/app/page' })],
      globalStyles: compileCss(SHEET, 'global', { generated: true } as object) as never,
    });
    await settle();
    const document = (globalThis as { document?: any }).document;
    const engine = document.querySelector('[testID="first"]').engine;
    const before = engine.stats.commits;
    app.instance.on.set(true);
    await settle();
    await settle();
    assert.ok(imageIn('first') && imageIn('second'));
    // The commit that gave both boxes the image, and one that drew it in both.
    assert.equal(engine.stats.commits - before, 2);
  });
});
