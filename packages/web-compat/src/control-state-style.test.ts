/**
 * A library's stylesheet that selects a checkbox or a radio by `:checked` or `:indeterminate`
 * follows the control's state however it changes, as a browser's does: a tap, a script setting
 * `checked`, a form binding, a radio of the group being checked, a form reset. Taiga UI draws its
 * checkbox's tick from `[tuiCheckbox]:checked::before`.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, compileCss, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

type Dom = any;

const CSS =
  '.box { opacity: 0.1 } .box:checked { opacity: 1 } .box:indeterminate { opacity: 0.5 }' +
  ' .box:not(:checked) { width: 4px } :checked { height: 9px }';

@Component({
  selector: 'x-controls',
  template: `
    <form id="form">
      <input id="a" class="box" type="checkbox" testID="a" />
      <input id="b" class="box" type="checkbox" checked testID="b" />
      <input id="r1" class="box" type="radio" name="r" checked testID="r1" />
      <input id="r2" class="box" type="radio" name="r" testID="r2" />
    </form>
  `,
})
class Controls {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

async function page() {
  const app = await render(Controls, {
    providers: [provideWebCompat()],
    globalStyles: compileCss(CSS, 'global', { generated: true } as object) as never,
  });
  await settle();
  const document: Dom = app.fixture.componentInstance.document;
  const element = (id: string): Dom => document.getElementById(id);
  const opacity = (id: string) => screen.getByTestId(id).props['opacity'];
  return { element, opacity };
}

describe("a library's :checked and :indeterminate", () => {
  it('match the state the control starts in, from its attribute', async () => {
    const { opacity } = await page();
    assert.deepEqual([opacity('a'), opacity('b'), opacity('r1'), opacity('r2')], [0.1, 1, 1, 0.1]);
  });

  it('follow a click that checks the control and one that unchecks it', async () => {
    const { element, opacity } = await page();
    element('a').click();
    await settle();
    assert.equal(opacity('a'), 1);
    assert.equal(screen.getByTestId('a').props['width'] ?? null, null);
    // A rule filed by the state alone, with no class to find it by.
    assert.equal(screen.getByTestId('a').props['height'], 9);
    element('a').click();
    await settle();
    assert.equal(opacity('a'), 0.1);
    assert.equal(screen.getByTestId('a').props['width'], 4);
  });

  it('follow a script setting checked and indeterminate', async () => {
    const { element, opacity } = await page();
    element('b').checked = false;
    await settle();
    assert.equal(opacity('b'), 0.1);
    element('a').indeterminate = true;
    await settle();
    assert.equal(opacity('a'), 0.5);
    element('a').indeterminate = false;
    await settle();
    assert.equal(opacity('a'), 0.1);
  });

  it('follow a radio of the group unchecking the one that was checked', async () => {
    const { element, opacity } = await page();
    element('r2').click();
    await settle();
    assert.deepEqual([opacity('r1'), opacity('r2')], [0.1, 1]);
  });

  it('go back to the attribute with a form reset', async () => {
    const { element, opacity } = await page();
    element('a').click();
    element('b').checked = false;
    await settle();
    element('form').reset();
    await settle();
    assert.deepEqual([opacity('a'), opacity('b')], [0.1, 1]);
  });

  it('leave the checked attribute as it was written, as a browser does', async () => {
    const { element } = await page();
    element('a').click();
    element('b').checked = false;
    await settle();
    assert.deepEqual(
      [element('a').getAttribute('checked'), element('b').getAttribute('checked')],
      [null, ''],
    );
    assert.deepEqual(
      [element('a').hasAttribute('checked'), element('b').hasAttribute('checked')],
      [false, true],
    );
  });
});
