/**
 * `blurFocused` on the web host, which `Keyboard.dismiss()` and a scroll view's tap elsewhere both
 * send. A clicked button takes the focus in a browser, and blurring it would drop the focus to the
 * page, so only a text field is blurred, as on a device.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { installJsdomEnvironment } from './jsdom-env.ts';
import type { BrowserEngine as Engine } from './browser-engine.ts';

describe('blurring the focused node on the web host', () => {
  let BrowserEngine: typeof Engine;
  let document: Document;

  before(async () => {
    document = installJsdomEnvironment().document;
    ({ BrowserEngine } = await import('./browser-engine.ts'));
  });

  function page() {
    const engine = new BrowserEngine(document);
    const field = engine.createElementNode('text-input');
    const button = engine.createElementNode('view');
    (button.el as HTMLElement).tabIndex = 0;
    document.body.append(field.el, button.el);
    return { engine, field: field.el as HTMLElement, button: button.el as HTMLElement };
  }

  it('blurs a focused text field', () => {
    const { engine, field } = page();
    field.focus();
    assert.equal(engine.focusedField?.el, field);
    engine.blurFocused();
    assert.notEqual(document.activeElement, field);
  });

  it('leaves the focus on anything else', () => {
    const { engine, button } = page();
    button.focus();
    assert.equal(engine.focusedField, null);
    engine.blurFocused();
    assert.equal(document.activeElement, button);
  });
});
