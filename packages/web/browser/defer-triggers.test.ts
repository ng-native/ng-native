/**
 * `@defer (on interaction | hover | viewport)` in a real Chromium: real input, and the browser's
 * own `IntersectionObserver`, which refuses anything that is not an element.
 */
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { boot, settle, waitFor } from './boot.ts';
import { DeferTriggersApp } from '../src/defer-triggers-app.ts';

describe('@defer on a trigger element, in Chromium', () => {
  it('loads on a click, on the pointer entering, and once scrolled into view', async () => {
    const errors = vi.spyOn(console, 'error');
    try {
      await page.viewport(1200, 800);
      const { root, byId } = boot(DeferTriggersApp);
      await settle();
      const text = (): string => root.textContent ?? '';

      await userEvent.click(byId('trigger'));
      await waitFor(() => text().includes('interaction loaded'), 'the click to load');
      // Forced: the placeholder goes as the pointer reaches it, which a hover that waits for a
      // stable element would retry until it timed out.
      await userEvent.hover(byId('hover-target'), { force: true });
      await waitFor(() => text().includes('hover loaded'), 'the hover to load');

      await settle();
      expect(text()).toContain('viewport waiting');
      byId('spot').scrollIntoView();
      await waitFor(() => text().includes('viewport loaded'), 'the scroll to load');
      expect(errors).not.toHaveBeenCalled();
    } finally {
      window.scrollTo(0, 0);
      errors.mockRestore();
    }
  });

  it('loads on a text-input whose element multiline swapped after the trigger was set', async () => {
    const errors = vi.spyOn(console, 'error');
    try {
      await page.viewport(1200, 800);
      const { root, byId, componentRef } = boot(DeferTriggersApp);
      await settle();
      const text = (): string => root.textContent ?? '';
      const before = [byId('field'), byId('seen')];
      (componentRef.instance as DeferTriggersApp).multiline.set(true);
      await settle();
      expect([byId('field').tagName, byId('seen').tagName]).toEqual(['TEXTAREA', 'TEXTAREA']);
      expect(before.some((el) => el.isConnected)).toBe(false);

      byId('field').scrollIntoView({ block: 'center' });
      await userEvent.click(byId('field'));
      await waitFor(() => text().includes('field loaded'), 'the click to load');
      await settle();
      expect(text()).toContain('seen waiting');
      byId('seen').scrollIntoView();
      await waitFor(() => text().includes('seen loaded'), 'the scroll to load');
      expect(errors).not.toHaveBeenCalled();
    } finally {
      window.scrollTo(0, 0);
      errors.mockRestore();
    }
  });
});
