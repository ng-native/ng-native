/**
 * What the stylesheet resolves to, which jsdom cannot answer at all: it loads no stylesheet, so
 * `getComputedStyle` there reports the inline style and nothing else. Every class string in this
 * library is therefore invisible to the existing suite - `src/sidebar.test.ts` says it plainly,
 * "jsdom loads no stylesheet, so the width class this component writes is never resolved into an
 * actual size".
 *
 * The four below are the ways that has already gone wrong, one test each: a border with a width
 * and no style, a text field wearing a textarea's own font and chrome, a state variant that
 * resolves to a selector nothing matches, and a variant that never fires because the attribute it
 * keys off is not written. Each renders as a page that looks subtly wrong and reports nothing.
 */
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { boot, settle, waitFor } from './boot.ts';
import { TextFieldApp } from '../src/text-fields-app.ts';
import { ButtonApp } from '../src/button-app.ts';

describe('resolved styles', () => {
  it('gives a hairline border a real width, not the zero a missing style leaves', async () => {
    await page.viewport(1200, 800);
    const { byId } = boot(TextFieldApp);
    await settle();

    const style = getComputedStyle(byId('plain'));
    // `border` in Tailwind v4 is `border-width: 1px` plus `border-style: var(--tw-border-style)`,
    // and that custom property only has its `solid` initial value because `utilities.css`
    // registers it with `@property`. Miss that - which is what happens if a page assumes
    // preflight is doing it - and the width is set, the style defaults to `none`, and every
    // border in the library computes to `0px` while the class is right there in the DOM.
    expect(style.borderTopStyle).toBe('solid');
    expect(parseFloat(style.borderTopWidth)).toBeGreaterThan(0);
    // And it is a hairline, not a slab.
    expect(parseFloat(style.borderTopWidth)).toBeLessThanOrEqual(2);
  });

  it("draws a text field in the page's text styles, with none of a browser field's chrome", async () => {
    await page.viewport(1200, 800);
    const { root } = boot(TextFieldApp);
    await settle();

    const field = getComputedStyle(root.querySelector('#plain [data-rn="text-input"]')!);
    const body = getComputedStyle(document.body);
    // Not the 13.33px Chromium gives a bare `<input>`, or the monospace a `<textarea>` gets.
    expect(field.fontFamily).toBe(body.fontFamily);
    expect(field.fontSize).toBe('14px');
    expect(field.paddingTop).toBe('0px');
    expect(field.paddingLeft).toBe('0px');
    expect(field.borderTopWidth).toBe('0px');
    expect(field.resize).toBe('none');
  });

  it('draws an unstyled placeholder fainter than the text, as a device does', async () => {
    // With no placeholderTextColor the placeholder inherited the text colour, so an empty field
    // looked filled in. iOS and Android both draw a default placeholder grey.
    await page.viewport(1200, 800);
    const { root } = boot(TextFieldApp);
    await settle();

    const field = root.querySelector('#plain [data-rn="text-input"]')!;
    const text = getComputedStyle(field).color;
    const placeholder = getComputedStyle(field, '::placeholder').color;
    expect(placeholder).not.toBe(text);
  });

  it('changes the border colour when the field takes focus', async () => {
    await page.viewport(1200, 800);
    const { byId, root } = boot(TextFieldApp);
    await settle();

    const host = byId('plain');
    const resting = getComputedStyle(host).borderTopColor;

    // The real field inside, focused for real. A text field always matches `:focus-visible` in
    // Chromium regardless of how focus arrived, which is the browser heuristic
    // `@ng-native/tailwind/web.css` points the variant at rather than reimplementing. Native
    // cannot make that distinction at all.
    (root.querySelector('#plain [data-rn="text-input"]') as HTMLInputElement).focus();
    await settle();

    const focused = await waitFor(() => {
      const colour = getComputedStyle(host).borderTopColor;
      return colour !== resting ? colour : null;
    }, 'the focus ring to appear');
    expect(focused).not.toBe(resting);
  });

  it('dims a disabled button, through the attribute the variant keys off', async () => {
    await page.viewport(1200, 800);
    const { componentRef, root } = boot(ButtonApp);
    await settle();

    const button = root.querySelector('#trigger') as HTMLElement;
    expect(parseFloat(getComputedStyle(button).opacity)).toBe(1);

    (componentRef.instance as InstanceType<typeof ButtonApp>).disabled.set(true);
    // `transition-all` is on the base button, so the opacity arrives over a real duration rather
    // than on the next tick - one more thing that only has a clock in a browser.
    await waitFor(
      () => parseFloat(getComputedStyle(button).opacity) <= 0.501,
      'the disabled fade to finish',
    );

    // `disabled:opacity-50` is `&[data-disabled], &:disabled` on this platform, and a custom
    // element is never `:disabled` - so this passing means `data-disabled` really reached the
    // host, and that the variant really did match it. Two claims that are each invisible without
    // a cascade to resolve.
    expect(parseFloat(getComputedStyle(button).opacity)).toBeCloseTo(0.5, 2);
  });
});
