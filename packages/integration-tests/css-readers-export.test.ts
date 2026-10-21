/**
 * The engine's CSS readers a package outside it reads values with: web-compat's
 * `element.style` and run-time `<style>` sheets read a colour, a token and a bound declaration as
 * the engine does, rather than with a copy that drifts from it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boundDeclaration, isNamedColor, parseColor, tokenFromValue } from '@ng-native/fabric';

describe("the engine's CSS readers, from the package", () => {
  it('read a colour, a token and a bound declaration', () => {
    assert.equal(isNamedColor('rebeccapurple'), true);
    assert.equal(isNamedColor('brand'), false);
    assert.deepEqual(parseColor('#f008'), [255, 0, 0, 0x88 / 255]);
    assert.notEqual(tokenFromValue('var(--brand)'), undefined);
    assert.notEqual(boundDeclaration('color', tokenFromValue('var(--brand, red)')), null);
  });
});
