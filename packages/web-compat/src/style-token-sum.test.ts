/**
 * A length a script sets as a sum of tokens, as Taiga UI sizes a field's text:
 * `el.style.fontSize = 'calc(1.25rem + var(--tui-font-offset))'`. Worked out where the tokens are,
 * where native was sent the text, which Android's text field crashed on.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component } from '@angular/core';
import { cleanup, compileCss, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

@Component({ selector: 'x-sized', template: `<p testID="p">Text</p>` })
class Sized {}

afterEach(cleanup);

describe('a sum of tokens a script sets on an element', () => {
  it('is worked out where the tokens are, and let go when set to anything else', async () => {
    await render(Sized, {
      providers: [provideWebCompat()],
      globalStyles: compileCss(':root { --o: 2px }', 'global', {
        generated: true,
      } as object) as never,
    });
    await settle();
    const p = (globalThis as { document?: any }).document.querySelector('p');
    p.style.fontSize = 'calc(1.25rem + var(--o))';
    await settle();
    assert.equal(screen.getByTestId('p').props['fontSize'], 22);
    assert.equal(p.style.fontSize, 'calc(1.25rem + var(--o))');
    p.style.fontSize = '12px';
    await settle();
    assert.equal(screen.getByTestId('p').props['fontSize'], 12);
  });
});
