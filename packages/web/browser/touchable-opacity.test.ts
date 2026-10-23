/**
 * A `<touchable-opacity>` dims to `activeOpacity` while pressed and eases back to the opacity the
 * cascade gives it, in a real browser: a class, an inline `[style]` and a bound `[style.opacity]`
 * alike. The pressed rule is `!important`, which is what lets it beat an inline opacity here too.
 */
import { describe, expect, it } from 'vitest';
import { boot, settle, waitFor } from './boot.ts';
import { TouchableOpacityApp } from '../src/touchable-opacity-app.ts';

const opacity = (el: Element) => Number(getComputedStyle(el).opacity);

describe('touchable-opacity on the web host', () => {
  for (const [id, active] of [
    ['class', 0.2],
    ['map', 0.3],
    ['bound', 0.2],
  ] as const) {
    it(`dims to ${active} and eases back to 0.5, given it by ${id}`, async () => {
      const { byId, pointer } = boot(TouchableOpacityApp);
      await settle();
      const el = byId(id);
      expect(opacity(el)).toBe(0.5);

      pointer(id, 'pointerdown');
      await waitFor(() => Math.abs(opacity(el) - active) < 1e-6, `${id} pressed`);

      // Held past `minPressDuration`, so the release is not deferred.
      await new Promise((resolve) => setTimeout(resolve, 150));
      pointer(id, 'pointerup');
      const seen: number[] = [];
      await waitFor(() => {
        seen.push(opacity(el));
        return Math.abs(opacity(el) - 0.5) < 1e-6;
      }, `${id} back to rest`);
      expect(Math.max(...seen)).toBeLessThanOrEqual(0.5 + 1e-6);
    });
  }
});
