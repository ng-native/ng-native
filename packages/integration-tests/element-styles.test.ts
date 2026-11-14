/**
 * The engine's own styles for HTML's text elements are a stylesheet it cannot compile for itself,
 * so the compiled form is written out beside the CSS. This fails when the two disagree.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ELEMENT_STYLES, ELEMENT_STYLES_CSS, Engine } from '@ng-native/fabric';
import { compileCss, createFakeFabric } from '@ng-native/testing';

it('ELEMENT_STYLES is ELEMENT_STYLES_CSS, compiled', () => {
  const warnings: string[] = [];
  const compiled = compileCss(ELEMENT_STYLES_CSS, 'element-styles', {
    onUnsupported: (message: string) => warnings.push(message),
  });
  assert.deepEqual(warnings, []);
  assert.deepEqual(JSON.parse(JSON.stringify(ELEMENT_STYLES.rules)), compiled.rules);
});

it('draws code in Menlo on a Mac, as on iOS', () => {
  const font = (platform: string) => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    engine.addClass(engine.root, `platform-${platform}`);
    const code = engine.createElement('code');
    engine.appendChild(engine.root, code);
    engine.appendChild(code, engine.createText('x'));
    engine.commit();
    return /"fontFamily":"([^"]+)"/.exec(JSON.stringify(fabric.committed, (key, value) =>
      key === 'parent' ? undefined : value,
    ))?.[1];
  };
  assert.equal(font('ios'), 'Menlo');
  assert.equal(font('macos'), 'Menlo');
  assert.equal(font('android'), 'monospace');
});
