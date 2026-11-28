/**
 * A box's mask of one SVG, drawn as that SVG in the box's background colour, sized and placed as
 * the mask is: how Taiga UI and Iconify draw an icon, which a browser shows as the icon's shape.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject, signal } from '@angular/core';
import {
  cleanup,
  compileCss,
  render,
  screen,
  settle,
  type FakeFabricNode,
} from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

type Dom = any;

const TICK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"' +
  ' stroke="#000" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>';
/** A Taiga UI icon: a line whose width is the mask's width past its height, at any size. */
const TAIGA =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"' +
  ' stroke="currentColor" stroke-width="calc((100vw - 100vh) / 10)"><path vector-effect="non-scaling-stroke" d="m6 9 6 6 6-6"/></svg>';
const SQUARE = '<svg viewBox="0 0 10 10"><rect width="10" height="10" style="fill: #123"/></svg>';
const url = (svg: string) => `url("data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}")`;

const CSS = `
  .icon { width: 24px; height: 24px; background: rgb(255, 0, 0); mask-image: var(--icon);
    mask-size: contain; mask-position: center; mask-repeat: no-repeat }
  .icon.blue { background: rgb(0, 0, 255) }
  .chevron { font-size: 16px; color: rgb(0, 128, 0); --tui-stroke-width: 2px }
  .chevron::before { content: ''; display: block; width: 1em; height: 1em; background: currentColor;
    mask-image: var(--icon); mask-repeat: no-repeat; mask-position: center;
    mask-size: calc(min(1em, 100%) + 10 * var(--tui-stroke-width)) min(1em, 100%) }
  .cover { width: 40px; height: 20px; background: black; mask-image: var(--icon);
    mask-size: cover; mask-position: right bottom; mask-repeat: no-repeat }
  .cover.sized { mask-size: 10px 10px }
`;

@Component({
  selector: 'x-masks',
  template: `
    <div class="icon" [class.blue]="blue()" testID="icon" [style.--icon]="icon()">
      <span testID="label">Label</span>
    </div>
    <div class="chevron" testID="chevron" [style.--icon]="chevron"></div>
    <div class="cover" [class.sized]="sized()" testID="cover" [style.--icon]="square"></div>
  `,
})
class Masks {
  readonly document: Dom = inject(DOCUMENT);
  readonly icon = signal<string>(url(TICK));
  readonly blue = signal(false);
  readonly sized = signal(false);
  readonly chevron = url(TAIGA);
  readonly square = url(SQUARE);
}

@Component({
  selector: 'x-fetched',
  template: `
    <div class="icon" testID="a" style="--icon: url(icons/tick.svg)"></div>
    <div class="icon" testID="b" style="--icon: url(icons/tick.svg)"></div>
    <div class="icon" testID="gone" style="--icon: url(icons/missing.svg)"></div>
  `,
})
class Fetched {}

@Component({
  selector: 'x-later',
  template: `<div class="icon" testID="later" style="--icon: url(icons/later.svg)"></div>`,
})
class Later {}

@Component({
  selector: 'x-pair',
  template: `
    <div class="icon" testID="first" style="--icon: url(icons/pair.svg)"></div>
    <div class="icon" testID="second" style="--icon: url(icons/pair.svg)"></div>
  `,
})
class Pair {}

afterEach(cleanup);

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);
const svgIn = (node: FakeFabricNode) =>
  flatten(node.children).find((n) => n.viewName === 'RNSVGSvgView');
const shapesIn = (node: FakeFabricNode) =>
  flatten(node.children).filter((n) => n.viewName === 'RNSVGPath' || n.viewName === 'RNSVGRect');

async function page() {
  const app = await render(Masks, {
    providers: [provideWebCompat()],
    globalStyles: compileCss(CSS, 'global', { generated: true } as object) as never,
  });
  await settle();
  await settle();
  return app.fixture.componentInstance;
}

describe('a mask of one SVG', () => {
  it('is drawn as the SVG in the colour the box would paint, which the box no longer paints', async () => {
    await page();
    const icon = screen.getByTestId('icon');
    assert.equal(icon.props['backgroundColor'] ?? null, null);
    const svg = svgIn(icon);
    assert.ok(svg, 'an SVG is drawn in the box');
    assert.equal(svg.props['color'], 'rgb(255, 0, 0)');
    const [tick] = shapesIn(icon);
    assert.equal(tick?.props['d'], 'M20 6 9 17l-5-5');
    // Its own colour is the mask's coverage only: painted in the box's.
    assert.deepEqual(tick?.props['stroke'], { type: 2 });
  });

  it('is drawn under what the box holds, which a script still sees as all it holds', async () => {
    const masks = await page();
    const icon = screen.getByTestId('icon');
    assert.equal(
      icon.children[0],
      icon.children.find((child) => svgIn(child) || child.viewName === 'RNSVGSvgView'),
    );
    const box = masks.document.querySelector('.icon');
    assert.deepEqual(
      Array.from(box.children as ArrayLike<Dom>).map((child) => child.localName),
      ['span'],
    );
  });

  it('is recoloured in place when the colour changes, and built again for another image', async () => {
    const masks = await page();
    const before = svgIn(screen.getByTestId('icon'));
    masks.blue.set(true);
    await settle();
    await settle();
    const after = svgIn(screen.getByTestId('icon'));
    assert.equal(after?.props['color'], 'rgb(0, 0, 255)');
    assert.equal(after?.reactTag, before?.reactTag, 'the same drawing');
    masks.icon.set(url(SQUARE));
    await settle();
    await settle();
    assert.equal(shapesIn(screen.getByTestId('icon'))[0]?.viewName, 'RNSVGRect');
  });

  it('goes with the mask, and the box paints its background again', async () => {
    const masks = await page();
    masks.icon.set('none');
    await settle();
    await settle();
    const icon = screen.getByTestId('icon');
    assert.equal(svgIn(icon), undefined);
    assert.equal(icon.props['backgroundColor'], 'rgb(255, 0, 0)');
  });

  it("is sized and placed as Taiga UI's icon in a ::before is, its line as wide as the theme's", async () => {
    await page();
    const chevron = screen.getByTestId('chevron');
    const svg = svgIn(chevron)!;
    assert.ok(svg, 'the ::before draws');
    assert.equal(svg.props['color'], 'rgb(0, 128, 0)');
    // The mask is min(1em, 100%) wide and tall, 16 points, with 20 more across it, centred.
    const holder = flatten(chevron.children).find((n) => n.children.includes(svg))!;
    assert.deepEqual([holder.props['width'], holder.props['maxWidth']], [16, '100%']);
    assert.deepEqual([holder.props['height'], holder.props['maxHeight']], [16, '100%']);
    assert.deepEqual([svg.props['left'], svg.props['right']], [-10, -10]);
    // `(100vw - 100vh) / 10` of a mask 36 by 16 is 2 points, which in a 24-unit drawing 16 points
    // tall is 3 units.
    assert.equal(shapesIn(chevron)[0]?.props['strokeWidth'], '3');
  });

  it('covers or contains the box, from the side its position says', async () => {
    await page();
    const svg = svgIn(screen.getByTestId('cover'))!;
    assert.deepEqual([svg.props['align'], svg.props['meetOrSlice']], ['xMaxYMax', 1]);
    const icon = svgIn(screen.getByTestId('icon'))!;
    assert.deepEqual([icon.props['align'], icon.props['meetOrSlice']], ['xMidYMid', 0]);
    // A shape's own fill in a style is the mask's coverage too.
    assert.deepEqual(shapesIn(screen.getByTestId('cover'))[0]?.props['fill'], { type: 2 });
  });

  it("takes the drawing's own aspect ratio again once the mask no longer covers the box", async () => {
    const masks = await page();
    masks.sized.set(true);
    await settle();
    await settle();
    const svg = svgIn(screen.getByTestId('cover'))!;
    assert.notEqual(svg.props['meetOrSlice'], 1, 'not sliced as a cover is');
    assert.notEqual(svg.props['align'], 'xMaxYMax');
  });
});

/** Taiga UI's compass: an SVG written into a data URL as it is, quotes and all. */
const COMPASS_CSS = `.needle { width: 12px; height: 16px; background: rgb(0, 0, 255);
  mask-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 9C4 8 8 8 12 9C10 6 8 3 6 0C4 3 2 6 0 9Z"/></svg>') }
  .broken { width: 12px; height: 12px; background: black;
    mask-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L x y"/><path d="M1 1 L2 2"/></svg>') }`;

@Component({
  selector: 'x-compass',
  template: `<div class="needle" testID="needle"></div>
    <div class="broken" testID="broken"></div>`,
})
class Compass {}

/** A drawing 20 by 10, and one whose paints let some of what is under them through. */
const WIDE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" viewBox="0 0 20 10"><rect width="20" height="10"/></svg>';
const SEE_THROUGH =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
  '<rect width="10" height="10" fill="transparent"/>' +
  '<rect width="10" height="10" fill="rgba(0, 0, 0, 0.5)" fill-opacity="0.5"/>' +
  '<rect width="10" height="10" stroke="#0008"/>' +
  '<rect width="10" height="10" style="fill: rgb(0 0 0 / 25%)"/>' +
  '<rect width="10" height="10" fill="#000"/></svg>';

const SIZED_CSS = `.m { width: 60px; height: 60px; background: black; mask-image: var(--icon);
    mask-repeat: no-repeat }
  .across { mask-size: 40px auto } .down { mask-size: auto 30px } .own { mask-size: auto }`;

@Component({
  selector: 'x-sized',
  template: `
    <div class="m across" testID="across" [style.--icon]="wide"></div>
    <div class="m down" testID="down" [style.--icon]="wide"></div>
    <div class="m own" testID="own" [style.--icon]="wide"></div>
    <div class="m own" testID="through" [style.--icon]="through"></div>
  `,
})
class Sized {
  readonly wide = url(WIDE);
  readonly through = url(SEE_THROUGH);
}

const holderOf = (testID: string) => {
  const box = screen.getByTestId(testID);
  const svg = svgIn(box)!;
  const holder = flatten(box.children).find((n) => n.children.includes(svg))!;
  return [holder.props['width'], holder.props['height']];
};

describe("a mask's size of auto", () => {
  it("is the other axis by the image's own ratio, or the image's own size on both", async () => {
    await render(Sized, {
      providers: [provideWebCompat()],
      globalStyles: compileCss(SIZED_CSS, 'global', { generated: true } as object) as never,
    });
    await settle();
    await settle();
    assert.deepEqual(holderOf('across'), [40, 20]);
    assert.deepEqual(holderOf('down'), [60, 30]);
    assert.deepEqual(holderOf('own'), [20, 10]);
  });

  it("keeps each paint's alpha, which is how much of the box the mask lets through", async () => {
    await render(Sized, {
      providers: [provideWebCompat()],
      globalStyles: compileCss(SIZED_CSS, 'global', { generated: true } as object) as never,
    });
    await settle();
    await settle();
    const shapes = shapesIn(screen.getByTestId('through'));
    assert.deepEqual(
      shapes.map((shape) => [shape.props['fillOpacity'], shape.props['strokeOpacity']]),
      [
        [0, undefined],
        [0.25, undefined],
        [undefined, 0.533],
        [0.25, undefined],
        [undefined, undefined],
      ],
    );
    assert.deepEqual(shapes[0]?.props['fill'], { type: 2 });
  });
});

describe('a mask written into a data URL as it is', () => {
  it("reads the SVG's own quotes, as a browser does, and draws its path", async () => {
    await render(Compass, {
      providers: [provideWebCompat()],
      globalStyles: compileCss(COMPASS_CSS, 'global', { generated: true } as object) as never,
    });
    await settle();
    await settle();
    const needle = screen.getByTestId('needle');
    const [path] = shapesIn(needle);
    assert.equal(path?.props['d'], 'M0 9C4 8 8 8 12 9C10 6 8 3 6 0C4 3 2 6 0 9Z');
    // With no size or view box of its own, it is the size of the box it is drawn over.
    assert.deepEqual(holderOf('needle'), [12, 16]);
  });

  it('leaves out a path native could not read, and draws the rest', async () => {
    await render(Compass, {
      providers: [provideWebCompat()],
      globalStyles: compileCss(COMPASS_CSS, 'global', { generated: true } as object) as never,
    });
    await settle();
    await settle();
    assert.deepEqual(
      shapesIn(screen.getByTestId('broken')).map((n) => n.props['d']),
      ['M1 1 L2 2'],
    );
  });
});

describe('a mask fetched from its address', () => {
  it('is fetched once for all the boxes that have it, and a box whose image fails draws nothing', async () => {
    const asked: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string) => {
      asked.push(String(input));
      const found = String(input).endsWith('tick.svg');
      return { ok: found, text: async () => TICK } as Response;
    }) as typeof fetch;
    try {
      await render(Fetched, {
        providers: [provideWebCompat({ url: 'https://example.com/app/' })],
        globalStyles: compileCss(CSS, 'global', { generated: true } as object) as never,
      });
      await settle();
      await settle();
      assert.deepEqual(asked.sort(), [
        'https://example.com/app/icons/missing.svg',
        'https://example.com/app/icons/tick.svg',
      ]);
      assert.ok(svgIn(screen.getByTestId('a')));
      assert.ok(svgIn(screen.getByTestId('b')));
      const gone = screen.getByTestId('gone');
      // A box whose mask image cannot be had paints no background of its own.
      assert.equal(svgIn(gone), undefined);
      assert.equal(gone.props['backgroundColor'] ?? null, null);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('is fetched again for a box that names it after a fetch of it failed', async () => {
    const original = globalThis.fetch;
    let online = false;
    globalThis.fetch = (async () => {
      if (!online) throw new TypeError('Network request failed');
      return { ok: true, text: async () => TICK } as Response;
    }) as typeof fetch;
    const app = () =>
      render(Later, {
        providers: [provideWebCompat({ url: 'https://example.com/app/' })],
        globalStyles: compileCss(CSS, 'global', { generated: true } as object) as never,
      });
    try {
      await app();
      await settle();
      await settle();
      assert.equal(svgIn(screen.getByTestId('later')), undefined);
      cleanup();
      online = true;
      await app();
      await settle();
      await settle();
      assert.ok(svgIn(screen.getByTestId('later')), 'drawn once its image can be had');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('draws every box an image arrives for in one commit', async () => {
    const original = globalThis.fetch;
    let arrive!: () => void;
    const arrived = new Promise<void>((resolve) => (arrive = resolve));
    globalThis.fetch = (async (input: string) => {
      await arrived;
      return { ok: String(input).endsWith('pair.svg'), text: async () => TICK } as Response;
    }) as typeof fetch;
    try {
      await render(Pair, {
        providers: [provideWebCompat({ url: 'https://example.com/app/' })],
        globalStyles: compileCss(CSS, 'global', { generated: true } as object) as never,
      });
      await settle();
      const document = (globalThis as { document?: any }).document;
      const engine = document.querySelector('[testID="first"]').engine;
      const before = engine.stats.commits;
      arrive();
      await settle();
      await settle();
      assert.ok(svgIn(screen.getByTestId('first')) && svgIn(screen.getByTestId('second')));
      // One commit for every box the image is drawn in, rather than one each.
      assert.equal(engine.stats.commits - before, 1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

const COUNTED_CSS = `${CSS}
  .icon > :first-child { opacity: 0.5 }
  .icon:empty { opacity: 0.25 }`;

@Component({
  selector: 'x-counted',
  template: `
    <div class="icon" testID="full" [style.--icon]="icon"><span testID="first">First</span></div>
    <div class="icon" testID="empty" [style.--icon]="icon"></div>
  `,
})
class Counted {
  readonly icon = url(TICK);
}

describe('a mask drawn in a box', () => {
  it('is no child of the box to :empty or :first-child', async () => {
    await render(Counted, {
      providers: [provideWebCompat()],
      globalStyles: compileCss(COUNTED_CSS, 'global', { generated: true } as object) as never,
    });
    await settle();
    await settle();
    assert.ok(svgIn(screen.getByTestId('empty')), 'the mask is drawn');
    assert.equal(screen.getByTestId('empty').props['opacity'], 0.25);
    assert.equal(screen.getByTestId('first').props['opacity'], 0.5);
  });
});
