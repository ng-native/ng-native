/**
 * What a browser's own stylesheet gives HTML's elements, under every rule an app or a library
 * writes: a paragraph's and a list's margins, a heading's size, weight and margins. A library's
 * template spaces its text by them, as Taiga UI's examples do.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, compileCss, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

@Component({
  selector: 'x-text',
  template: `
    <div style="font-size: 16px">
      <p testID="p">Text</p>
      <h1 testID="h1">Title</h1>
      <h3 testID="h3">Part</h3>
      <ul testID="ul">
        <li>One</li>
      </ul>
      <blockquote testID="quote">Said</blockquote>
      <p class="flat" testID="flat">Flat</p>
    </div>
  `,
})
class Text {
  readonly document: any = inject(DOCUMENT);
}

afterEach(cleanup);

async function page() {
  const app = await render(Text, {
    providers: [provideWebCompat()],
    globalStyles: compileCss('.flat { margin: 0 }', 'global', {
      generated: true,
    } as object) as never,
  });
  await settle();
  const document = app.fixture.componentInstance.document;
  // As a script reads them: each element's own, before adjacent margins collapse into one gap.
  return (id: string): Record<string, string> => {
    const element = document.querySelector(`[testID="${id}"]`);
    return new Proxy(
      {},
      { get: (_, key: string) => document.defaultView.getComputedStyle(element)[key] },
    );
  };
}

describe("a browser's own styles for HTML's elements", () => {
  it('gives a paragraph and a list their margins, and a list its indent', async () => {
    const props = await page();
    assert.deepEqual([props('p')['marginTop'], props('p')['marginBottom']], ['16px', '16px']);
    assert.equal(props('ul')['marginTop'], '16px');
    // Its indent is on the side its text starts, as a browser's `padding-inline-start` is.
    assert.equal(screen.getByTestId('ul').props['paddingStart'], 40);
    assert.deepEqual([props('quote')['marginLeft'], props('quote')['marginTop']], ['40px', '16px']);
  });

  it('gives a heading its size, weight and margins, in ems of its own size', async () => {
    const props = await page();
    const h1 = props('h1');
    assert.deepEqual(
      [h1['fontSize'], h1['fontWeight'], h1['marginTop']],
      ['32px', '700', '21.44px'],
    );
    assert.deepEqual([props('h3')['fontSize'], props('h3')['marginTop']], ['18.72px', '18.72px']);
  });

  it('is under any rule a stylesheet writes, whatever its specificity', async () => {
    const props = await page();
    assert.deepEqual([props('flat')['marginTop'], props('flat')['marginBottom']], ['0px', '0px']);
  });
});
