/**
 * A drawing's own stroke cap and join, `stroke-linecap="round"` on the `<svg>`, handed down to its
 * shapes as SVG hands them down: Lucide's help icon draws the dot under its question mark as a
 * line 0.01 long, which only a round cap shows.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component } from '@angular/core';
import { cleanup, render, screen, settle, type FakeFabricNode } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

@Component({
  selector: 'x-help',
  template: `
    <svg
      testID="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M12 17h.01" />
      <path d="M4 4h4" stroke-linecap="square" />
    </svg>
  `,
})
class Help {}

afterEach(cleanup);

const paths = (node: FakeFabricNode): FakeFabricNode[] =>
  node.children.flatMap((child) => [
    ...(child.viewName === 'RNSVGPath' ? [child] : []),
    ...paths(child),
  ]);

describe("a drawing's stroke cap and join", () => {
  it('are its shapes\x27, under a shape\x27s own', async () => {
    await render(Help, { providers: [provideWebCompat()] });
    await settle();
    const [dot, line] = paths(screen.getByTestId('icon'));
    assert.deepEqual([dot?.props['strokeLinecap'], dot?.props['strokeLinejoin']], [1, 1]);
    assert.deepEqual([line?.props['strokeLinecap'], line?.props['strokeLinejoin']], [2, 1]);
  });
});
