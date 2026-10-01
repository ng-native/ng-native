/**
 * Every control's events, from real input in a real Chromium: keys typed through Playwright, a
 * real focus moving, a real scroll. jsdom dispatches whatever event a test builds, so it can say
 * a handler runs and never whether the browser would have sent the event in the first place.
 */
import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { boot, settle, waitFor } from './boot.ts';
import { EventsApp } from '../src/events-app.ts';
import { BrowserEngine } from '../src/browser-engine.ts';

async function scene() {
  await page.viewport(1200, 800);
  const booted = boot(EventsApp);
  await settle();
  const app = booted.componentRef.instance as EventsApp;
  const events = (): readonly string[] => app.events();
  const clear = (): void => app.events.set([]);
  return { ...booted, app, events, clear };
}

describe('a pressable, from a mouse', () => {
  it('presses on the primary button and not on a right click', async () => {
    const { byId, events, clear } = await scene();
    await userEvent.click(byId('button'), { button: 'right' });
    await settle();
    expect(events()).toEqual([]);
    clear();
    await userEvent.click(byId('button'));
    await waitFor(() => events().includes('pressOut'), 'the press to end');
    expect(events()).toEqual(['pressIn', 'press', 'pressOut']);
  });
});

describe('a pressable, from the keyboard', () => {
  it('presses on Enter, the way a focused button does', async () => {
    const { byId, events } = await scene();
    byId('button').focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => events().includes('pressOut'), 'the press to end');
    expect(events()).toEqual(['pressIn', 'press', 'pressOut']);
  });

  it('presses on Space when the key comes up, and holds the press while it is down', async () => {
    const { byId, events } = await scene();
    byId('button').focus();
    await userEvent.keyboard('[Space>]');
    await settle();
    expect(events()).toEqual(['pressIn']);
    // Held past minPressDuration (130ms), so pressOut is not deferred and fires on release ahead
    // of press, as React Native orders them. A shorter hold would race the runner's speed.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await userEvent.keyboard('[/Space]');
    await waitFor(() => events().includes('press'), 'the press to end');
    expect(events()).toEqual(['pressIn', 'pressOut', 'press']);
  });
});

describe('a text field, on Enter', () => {
  it('submits a single line and lets go of it, as blurAndSubmit does on a device', async () => {
    const { byId, events } = await scene();
    const field = byId('line');
    await userEvent.click(field);
    await userEvent.keyboard('hi{Enter}');
    await waitFor(() => events().includes('blur'), 'the field to blur');
    expect(events()).toEqual(['focus', 'submitEditing', 'endEditing', 'blur']);
    expect(document.activeElement).not.toBe(field);
  });

  it('submits a multiline field whose submitBehavior says so, keeping focus', async () => {
    const { byId, app, events } = await scene();
    const field = byId('chat');
    await userEvent.click(field);
    await userEvent.keyboard('a{Enter}');
    await settle();
    expect(events()).toEqual(['submitEditing']);
    expect(app.chat()).toBe('a');
    expect(document.activeElement).toBe(field);
  });

  it('adds a line to a multiline field by default', async () => {
    const { byId, app } = await scene();
    await userEvent.click(byId('notes'));
    await userEvent.keyboard('a{Enter}b');
    await settle();
    expect(app.notes()).toBe('a\nb');
  });
});

describe('a horizontal scroll view', () => {
  it('lays its content out in a row as wide as the content, and reports that size', async () => {
    const { byId, app } = await scene();
    const strip = byId('strip');
    expect(getComputedStyle(strip).flexDirection).toBe('row');
    expect((strip.firstElementChild as HTMLElement).getBoundingClientRect().width).toBe(160);
    await waitFor(() => app.contentSize(), 'the content size');
    expect(app.contentSize()?.width).toBe(160);
  });

  it('reports where it came to rest once a scroll ends, as momentumScrollEnd', async () => {
    const { byId, app } = await scene();
    byId('strip').scrollTo({ left: 30, behavior: 'smooth' });
    await waitFor(() => app.restedAt() !== null, 'the scroll to come to rest');
    expect(app.restedAt()).toBe(30);
  });
});

describe('a scroll view with scrollEnabled off', () => {
  it('ignores the wheel, and still moves for scrollTo', async () => {
    const { byId } = await scene();
    const frozen = byId('frozen');
    await userEvent.hover(frozen);
    await userEvent.wheel(frozen, { delta: { y: 40 } });
    await settle();
    expect(frozen.scrollTop).toBe(0);
    frozen.scrollTo({ top: 25 });
    expect(frozen.scrollTop).toBe(25);
  });
});

describe('a text field swapped by multiline', () => {
  it('keeps the focus and the caret Chromium had, and the keyboard type it goes back to', async () => {
    const engine = new BrowserEngine(document);
    const node = engine.createElementNode('text-input');
    document.body.append(node.el);
    engine.setProp(node, 'keyboardType', 'phone-pad');
    await userEvent.type(node.el as HTMLInputElement, '01234 567890');
    (node.el as HTMLInputElement).setSelectionRange(2, 5);
    engine.setProp(node, 'multiline', true);
    const area = node.el as HTMLTextAreaElement;
    expect(document.activeElement).toBe(area);
    expect([area.selectionStart, area.selectionEnd]).toEqual([2, 5]);
    engine.setProp(node, 'multiline', false);
    const input = node.el as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect([input.type, input.selectionStart, input.selectionEnd]).toEqual(['tel', 2, 5]);
    await userEvent.keyboard('x');
    expect(input.value).toBe('01x 567890');
    input.remove();
  });
});

/*
 * Why an email, url or search keyboard sets inputmode and leaves the field a text field, in the
 * browser that would break if it did not. In Chromium a type="email" field throws from
 * setSelectionRange, reads null for selectionStart, trims what the app sets, and hides the spaces
 * the user types from its value, so what changeText reports would differ from what is on screen.
 * A type="url" field trims what the app sets, and a type="search" field empties itself on Escape.
 */
describe('a text field with an email, url or search keyboard', () => {
  for (const [keyboard, mode] of [
    ['email-address', 'email'],
    ['url', 'url'],
    ['web-search', 'search'],
  ] as const) {
    it(`keeps the value, the spaces typed and the selection, with ${keyboard}`, async () => {
      const engine = new BrowserEngine(document);
      const node = engine.createElementNode('text-input');
      const input = node.el as HTMLInputElement;
      document.body.append(input);
      engine.setProp(node, 'text', ' a@b.c ');
      engine.setProp(node, 'keyboardType', keyboard);
      expect([input.inputMode, input.value]).toEqual([mode, ' a@b.c ']);
      engine.setProp(node, 'selection', { start: 1, end: 4 });
      expect([input.selectionStart, input.selectionEnd]).toEqual([1, 4]);
      input.setSelectionRange(input.value.length, input.value.length);
      await userEvent.type(input, ' x ');
      expect(input.value).toBe(' a@b.c  x ');
      await userEvent.keyboard('{Escape}');
      expect(input.value).toBe(' a@b.c  x ');
      expect(input.type).toBe('text');
      input.remove();
    });
  }
});
