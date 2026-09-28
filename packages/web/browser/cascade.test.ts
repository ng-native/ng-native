/**
 * What a style resolves to once a browser has laid it out and painted it, for the things jsdom
 * answers with a string or not at all.
 *
 * jsdom reports a `gap` as written and every box at zero, keeps `env()` out of a declaration
 * entirely, never matches `:active` or `:hover`, has no `prefers-color-scheme` to change, and
 * gives back a transform, a gradient or a shadow as the text it was handed. Each of those is a
 * place `src/*.test.ts` can say what the engine wrote and not whether it worked - and each has
 * already been wrong in a way only a screen showed: numbers with no units, a React Native shadow
 * that was not CSS, a static style the style handler threw away.
 *
 * `src/cascade-app.ts` holds one of each, and every test here measures against its own elements.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { CascadeApp } from '../src/cascade-app.ts';
import { boot, settle, waitFor, type Booted } from './boot.ts';

async function scene(options: { asAnAppMounts?: boolean } = {}): Promise<Booted> {
  await page.viewport(1200, 800);
  const booted = boot(CascadeApp, options);
  await settle();
  return booted;
}

const rect = (el: Element): DOMRect => el.getBoundingClientRect();
const computed = (el: Element): CSSStyleDeclaration => getComputedStyle(el);

afterEach(async () => {
  await commands.pointerUp();
  await commands.emulateColorScheme('light');
});

describe('layout', () => {
  it('stacks a view in a column by default, stretched, with its gap between', async () => {
    const { byId } = await scene();
    const [column, c1, c2] = ['column', 'c1', 'c2'].map(byId);
    expect(rect(c2).top - rect(c1).bottom).toBe(16);
    expect(rect(c1).left).toBe(rect(c2).left);
    expect(rect(c1).width).toBe(rect(column).width);
  });

  it('spaces a row by a numeric gap from [style], in points', async () => {
    const { byId } = await scene();
    expect(rect(byId('r2')).left - rect(byId('r1')).right).toBe(12);
    expect(rect(byId('r2')).top).toBe(rect(byId('r1')).top);
  });

  it('places an absolutely positioned card at the numbers it was given', async () => {
    const { byId } = await scene();
    const stage = rect(byId('stage'));
    const card = rect(byId('popover'));
    expect([card.left - stage.left, card.top - stage.top]).toEqual([40, 96]);
    expect([card.width, card.height]).toEqual([60, 20]);
  });

  it('moves a view by its transform list without moving its layout box', async () => {
    const { byId } = await scene();
    const moved = byId('moved');
    const parent = rect(moved.parentElement!);
    // `offsetLeft` and `offsetTop` are where layout put the box; the rect is where it was drawn.
    expect(rect(moved).left - parent.left - moved.offsetLeft).toBe(30);
    expect(rect(moved).top - parent.top - moved.offsetTop).toBe(10);
  });
});

describe('[animatedStyle]', () => {
  /*
   * The directive an app uses on a device, imported the way an app imports it. In a browser the
   * package's `browser` condition resolves that import to the React-free graph, and every frame
   * of it is written through the engine's `setProp(node, 'style', ...)`.
   */
  it('fades and slides over real frames, then settles at the end values', async () => {
    const { byId, componentRef } = await scene();
    const el = byId('animated');
    const start = rect(el).left;
    const sample = (): [opacity: number, shift: number] => [
      parseFloat(computed(el).opacity),
      rect(el).left - start,
    ];
    expect(sample()).toEqual([1, 0]);

    let finished: boolean | null = null;
    (componentRef.instance as CascadeApp).play((result) => (finished = result));
    const seen: [opacity: number, shift: number][] = [];
    await waitFor(() => (seen.push(sample()), finished !== null), 'the animation to end');

    expect(finished).toBe(true);
    const [opacity, shift] = sample();
    expect(opacity).toBeCloseTo(0.2);
    expect(shift).toBeCloseTo(40);
    // In between rather than a jump: a timing curve that only ever falls, and a spring under way.
    expect(seen.some(([o]) => o < 0.95 && o > 0.25)).toBe(true);
    expect(seen.some(([, x]) => x > 1 && x < 39)).toBe(true);
    seen.slice(1).forEach(([o], i) => expect(o).toBeLessThanOrEqual(seen[i]![0] + 1e-6));
    // The template's own style on the element survives every frame the directive writes.
    expect(computed(el).backgroundColor).toBe('rgb(3, 2, 1)');
  });

  it('reaches none of React Native to do it', () => {
    const loaded = performance.getEntriesByType('resource').map((entry) => entry.name);
    expect(loaded.some((name) => name.includes('components/src/animations-web.ts'))).toBe(true);
    expect(loaded.filter((name) => /\/react-native\//.test(name))).toEqual([]);
  });
});

describe('paint', () => {
  it('draws a linear gradient between the colours the classes name', async () => {
    const { byId } = await scene();
    const image = computed(byId('gradient')).backgroundImage;
    expect(image).toMatch(/^linear-gradient\(to right/);
    expect(image).toContain('rgb(255, 0, 0)');
    expect(image).toContain('rgb(0, 0, 255)');
  });

  it("casts React Native's shadow keys as one box-shadow, at the opacity they give", async () => {
    const { byId } = await scene();
    const shadow = computed(byId('shadow')).boxShadow;
    // `color-mix` has resolved to a colour at 45% alpha, whatever notation Chromium reports it in.
    expect(shadow).toMatch(/0\.45\)? 0px 6px 12px 0px$/);
  });

  it('draws a border from its width alone, solid and black, as a device does', async () => {
    const { byId } = await scene();
    const framed = computed(byId('framed'));
    expect(framed.borderTopWidth).toBe('2px');
    expect(framed.borderTopStyle).toBe('solid');
    expect(framed.borderTopColor).toBe('rgb(0, 0, 0)');
    // And a class still says otherwise.
    expect(computed(byId('tinted-frame')).borderTopColor).toBe('rgb(255, 0, 0)');
  });

  it('draws a turning spinner in its colour, and hides it once stopped', async () => {
    const { byId } = await scene();
    const ring = getComputedStyle(byId('spinner'), '::after');
    expect(ring.borderTopColor).toBe('rgb(255, 0, 0)');
    expect(ring.borderTopWidth).toBe('2px');
    expect(ring.animationName).toBe('rn-activity-indicator');
    expect(parseFloat(ring.width)).toBe(20);
    const stopped = getComputedStyle(byId('stopped'), '::after');
    expect(stopped.animationPlayState).toBe('paused');
    expect(stopped.visibility).toBe('hidden');
  });

  it('blurs an image by its blurRadius, and covers its box with no resizeMode', async () => {
    const { byId } = await scene();
    const style = computed(byId('blurred'));
    expect(style.filter).toBe('blur(4px)');
    expect(style.backgroundSize).toBe('cover');
    expect(style.backgroundRepeat).toBe('no-repeat');
  });
});

describe('state', () => {
  it("applies a component's :active rule while the pointer is down, and only then", async () => {
    const { byId } = await scene();
    const held = byId('held');
    expect(computed(held).backgroundColor).toBe('rgb(1, 1, 1)');
    await commands.pointerDown('#held');
    await waitFor(() => computed(held).backgroundColor === 'rgb(2, 2, 2)', ':active to match');
    await commands.pointerUp();
    await waitFor(() => computed(held).backgroundColor === 'rgb(1, 1, 1)', ':active to clear');
  });

  it("scopes each component's sheet to its own elements", async () => {
    const { byId } = await scene();
    expect(computed(byId('card-label')).color).toBe('rgb(0, 128, 0)');
    expect(computed(byId('badge-label')).color).toBe('rgb(0, 0, 255)');
    // The page's own `.label`, which neither component's rule may reach.
    const plain = computed(byId('plain')).color;
    expect(plain).not.toBe('rgb(0, 128, 0)');
    expect(plain).not.toBe('rgb(0, 0, 255)');
  });
});

describe('the Tailwind web preset', () => {
  it('matches press: while the pointer is down, as :active', async () => {
    const { byId } = await scene();
    const pressed = byId('pressed');
    expect(computed(pressed).backgroundColor).toBe('rgb(16, 16, 16)');
    await commands.pointerDown('#pressed');
    await waitFor(() => computed(pressed).backgroundColor === 'rgb(32, 32, 32)', 'press:');
  });

  it('matches hover: under a real pointer', async () => {
    const { byId } = await scene();
    const hovered = byId('hovered');
    expect(computed(hovered).backgroundColor).toBe('rgb(48, 48, 48)');
    await userEvent.hover(hovered);
    await waitFor(() => computed(hovered).backgroundColor === 'rgb(64, 64, 64)', 'hover:');
    await userEvent.unhover(hovered);
  });

  it('follows the OS into dark:, through ColorScheme and the class it binds', async () => {
    const { byId } = await scene();
    const themed = byId('themed');
    expect(computed(themed).backgroundColor).toBe('rgb(255, 255, 255)');
    await commands.emulateColorScheme('dark');
    await waitFor(() => computed(themed).backgroundColor === 'rgb(0, 0, 0)', 'dark:');
  });

  it("pads pt-safe by the device's inset, and by nothing without one", async () => {
    const { byId } = await scene();
    // A browser reports no inset outside a notched, viewport-fit page, so the notch is the custom
    // property `web.css` fills from `env()`, set as a static style the way a test device would.
    expect(computed(byId('notched')).paddingTop).toBe('30px');
    expect(computed(byId('unnotched')).paddingTop).toBe('0px');
  });
});

describe('the reset mount injects by default', () => {
  // `mount` injects `reset.css` into the head unless told not to, after the app's own stylesheet.
  // Unlayered, and as specific as a class, it beat every Tailwind utility it shares a property
  // with: a `border-2` drew nothing, a `flex-row` stacked, a `hidden` showed. In Tailwind's `base`
  // layer it is below every utility, which is where a reset belongs.
  afterEach(() => document.getElementById('angular-native-web-reset')?.remove());

  it('leaves every utility above it', async () => {
    // As an app mounts, with the reset injected by `mount` itself.
    const { byId } = await scene({ asAnAppMounts: true });
    expect(document.getElementById('angular-native-web-reset')).not.toBeNull();
    const framed = computed(byId('tinted-frame'));
    expect(framed.borderTopWidth).toBe('2px');
    expect(framed.borderTopColor).toBe('rgb(255, 0, 0)');
    expect(computed(byId('column').parentElement!).flexDirection).toBe('row');
  });
});
