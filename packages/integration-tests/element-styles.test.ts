/**
 * The engine's own styles for HTML's text elements are a stylesheet it cannot compile for itself,
 * so the compiled form is written out beside the CSS. This fails when the two disagree.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ELEMENT_STYLES, ELEMENT_STYLES_CSS } from '@ng-native/fabric';
import { compileCss } from '@ng-native/testing';

it('ELEMENT_STYLES is ELEMENT_STYLES_CSS, compiled', () => {
  const warnings: string[] = [];
  const compiled = compileCss(ELEMENT_STYLES_CSS, 'element-styles', {
    onUnsupported: (message: string) => warnings.push(message),
  });
  assert.deepEqual(warnings, []);
  assert.deepEqual(JSON.parse(JSON.stringify(ELEMENT_STYLES.rules)), compiled.rules);
});
