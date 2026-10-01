/**
 * The Tailwind 3 web preset, `@ng-native/tailwind/web-preset.cjs`, built by Tailwind 3's own CLI
 * with a `tw-` prefix and resolved by Chromium against a mounted app.
 *
 * Each test is something the native preset gets wrong in a browser: its variants are for a phone,
 * and under a prefix Tailwind 3 prefixes the root classes they read, which `mount` keeps
 * unprefixed.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { boot, settle, waitFor } from './boot.ts';
import { TAILWIND_3_CLASSES, Tailwind3App } from '../src/tailwind-3-app.ts';

let sheet: HTMLStyleElement;
/** The suite's Tailwind 4 sheet, off for this file: its `web.css` sets the same root tokens. */
let others: CSSStyleSheet[] = [];

beforeAll(async () => {
  others = [...document.styleSheets].filter((s) => !s.disabled);
  for (const other of others) other.disabled = true;
  sheet = document.createElement('style');
  sheet.textContent = await commands.tailwind3(TAILWIND_3_CLASSES, 'tw-');
  document.head.append(sheet);
});

afterAll(() => {
  sheet.remove();
  for (const other of others) other.disabled = false;
});

afterEach(async () => {
  await commands.emulateColorScheme('light');
  await commands.deviceScale(1);
});

async function scene() {
  await page.viewport(1200, 800);
  const booted = boot(Tailwind3App);
  await settle();
  const style = (id: string) => getComputedStyle(booted.byId(id));
  return { ...booted, style, app: booted.componentRef.instance as Tailwind3App };
}

const BLACK = 'rgb(0, 0, 0)';
const RED = 'rgb(239, 68, 68)';
const BLUE = 'rgb(59, 130, 246)';

describe('the Tailwind 3 web preset under a prefix', () => {
  it('matches web: against the platform class mount puts on the root, and no native platform', async () => {
    const { style } = await scene();
    expect(style('web').paddingTop).toBe('8px');
    expect(style('ios').paddingTop).toBe('0px');
  });

  it('matches dark: while ColorScheme.set() chooses dark, through darkClass', async () => {
    const { app, style, applicationRef } = await scene();
    expect(style('themed').backgroundColor).not.toBe(BLACK);
    app.scheme.set('dark');
    applicationRef.tick();
    await waitFor(() => style('themed').backgroundColor === BLACK, 'dark: to apply');
    app.scheme.set('light');
    applicationRef.tick();
    await waitFor(() => style('themed').backgroundColor !== BLACK, 'dark: to go');
  });

  it('matches dark: while the system is dark', async () => {
    const { style } = await scene();
    await commands.emulateColorScheme('dark');
    await waitFor(() => style('themed').backgroundColor === BLACK, 'dark: to apply');
  });

  it('applies hover: and group-hover: on a real mouse hover', async () => {
    const { byId, style } = await scene();
    await userEvent.hover(byId('label'));
    await settle();
    expect(style('button').backgroundColor).toBe(RED);
    expect(style('label').color).toBe(RED);
  });

  it('applies focus-visible: for keyboard focus, and not for a click', async () => {
    const { byId, style } = await scene();
    await userEvent.click(byId('button'));
    await settle();
    expect(document.activeElement).toBe(byId('button'));
    expect(style('button').backgroundColor).not.toBe(BLUE);
    byId('button').blur();
    await userEvent.unhover(byId('button'));
    await userEvent.keyboard('{Tab}');
    await settle();
    expect(document.activeElement).toBe(byId('button'));
    expect(style('button').backgroundColor).toBe(BLUE);
  });

  it("keeps Tailwind's own monospace stack, as web.css does", async () => {
    const { style } = await scene();
    expect(style('mono').fontFamily).toMatch(/^ui-monospace,/);
  });

  it('draws a hairline as one device pixel on a 2x screen', async () => {
    await commands.deviceScale(2);
    // Chromium evaluates a sheet's media queries again only when it is inserted.
    document.head.append(sheet);
    const { byId } = await scene();
    expect(window.devicePixelRatio).toBe(2);
    expect(byId('hairline').getBoundingClientRect().height).toBe(0.5);
  });

  it("reads the safe area from the browser's env() insets", async () => {
    const { root, style } = await scene();
    expect(getComputedStyle(root).getPropertyValue('--safe-area-inset-top')).not.toBe('');
    expect(style('safe').paddingTop).toBe('0px');
  });
});
