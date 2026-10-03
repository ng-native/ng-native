/**
 * `Renderer2.listen('window', ...)`, which a library calls directly: a global target has nothing
 * behind it on a device, so the listener attaches to nothing rather than throwing.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Component, RendererFactory2 } from '@angular/core';
import { Text } from '@ng-native/components';
import { cleanup, render } from '@ng-native/testing';

afterEach(cleanup);

@Component({ selector: 'x-plain', imports: [Text], template: `<text>plain</text>` })
class Plain {}

test('a listener on window, document or body attaches to nothing', async () => {
  const { componentRef } = await render(Plain);
  const renderer = componentRef.injector.get(RendererFactory2).createRenderer(null, null);
  for (const target of ['window', 'document', 'body']) {
    const unlisten = renderer.listen(target, 'resize', () => {});
    assert.equal(typeof unlisten, 'function', target);
    unlisten();
  }
});
