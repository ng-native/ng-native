/**
 * A library's stylesheet that selects a field by `:placeholder-shown` follows whether it shows its
 * placeholder: Taiga UI rests a field's label inside it while it is empty, and moves it up once
 * there is text, `[tuiInput]:not(._empty, :placeholder-shown) ~ [tuiLabel]`.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, compileCss, fireEvent, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

type Dom = any;

const CSS =
  '.f { opacity: 1 } .f:placeholder-shown { opacity: 0.5 } .f:not(:placeholder-shown) ~ .label { opacity: 0.2 }';

@Component({
  selector: 'x-fields',
  template: `
    <div>
      <input id="a" class="f" placeholder="Name" testID="a" />
      <span class="label" testID="label">Name</span>
    </div>
    <input id="b" class="f" testID="b" />
  `,
})
class Fields {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

async function page() {
  const app = await render(Fields, {
    providers: [provideWebCompat()],
    globalStyles: compileCss(CSS, 'global', { generated: true } as object) as never,
  });
  await settle();
  const document: Dom = app.fixture.componentInstance.document;
  return {
    element: (id: string): Dom => document.getElementById(id),
    opacity: (id: string) => screen.getByTestId(id).props['opacity'],
  };
}

describe("a library's :placeholder-shown", () => {
  it('matches an empty field with a placeholder, and not one with none', async () => {
    const { opacity } = await page();
    assert.deepEqual([opacity('a'), opacity('b')], [0.5, 1]);
    assert.equal(opacity('label') ?? 1, 1);
  });

  it('follows what is typed, and a sibling rule with it', async () => {
    const { opacity } = await page();
    await fireEvent.changeText(screen.getByTestId('a'), 'Ada');
    await settle();
    assert.deepEqual([opacity('a'), opacity('label')], [1, 0.2]);
  });

  it('follows a script setting the value, and the placeholder coming and going', async () => {
    const { element, opacity } = await page();
    element('a').value = 'Ada';
    await settle();
    assert.equal(opacity('a'), 1);
    element('a').value = '';
    await settle();
    assert.equal(opacity('a'), 0.5);
    element('a').removeAttribute('placeholder');
    await settle();
    assert.equal(opacity('a'), 1);
    element('b').setAttribute('placeholder', 'Email');
    await settle();
    assert.equal(opacity('b'), 0.5);
  });
});
