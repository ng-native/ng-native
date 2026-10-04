/**
 * `<markdown>` in the browser host: the same component a device draws, as DOM. A paragraph's spans
 * are elements inside its element, raw HTML stays text, and a pressed link reaches the app.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { installJsdomEnvironment } from './jsdom-env.ts';
import type { MarkdownApp as App } from './markdown-app.ts';

async function boot(source: string) {
  const { document } = installJsdomEnvironment();
  const [{ mount }, { MarkdownApp }] = await Promise.all([
    import('./mount.ts'),
    import('./markdown-app.ts'),
  ]);
  const root = document.createElement('app-root');
  document.body.appendChild(root);
  const { componentRef, applicationRef } = mount(root, MarkdownApp);
  const app = componentRef.instance as App;
  app.source.set(source);
  applicationRef.tick();
  return { document, componentRef, applicationRef, app };
}

describe('<markdown> in the browser', () => {
  it('draws a heading and a paragraph whose emphasis is an element inside it', async () => {
    const { document, componentRef } = await boot('# Title\n\nSome *very* plain text');
    const texts = [...document.querySelectorAll('markdown > text')];
    assert.deepEqual(
      texts.map((one) => one.textContent),
      ['Title', 'Some very plain text'],
    );
    assert.equal(texts[1]!.querySelector('text')!.textContent, 'very');
    componentRef.destroy();
  });

  it('keeps raw HTML as text, making no element of it', async () => {
    const { document, componentRef } = await boot('<img src=x onerror=alert(1)>');
    const markdown = document.querySelector('markdown')!;
    assert.equal(markdown.querySelector('img'), null);
    assert.equal(markdown.textContent, '<img src=x onerror=alert(1)>');
    componentRef.destroy();
  });

  it('reports a pressed link', async () => {
    const { document, componentRef, applicationRef, app } = await boot('[docs](/docs)');
    const link = document.querySelector('markdown text text')!;
    for (const type of ['pointerdown', 'pointerup']) {
      link.dispatchEvent(
        new (globalThis as any).PointerEvent(type, { pointerId: 1, bubbles: true }),
      );
    }
    applicationRef.tick();
    assert.deepEqual(app.presses, ['/docs']);
    componentRef.destroy();
  });
});
