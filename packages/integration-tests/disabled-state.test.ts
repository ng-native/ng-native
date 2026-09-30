/**
 * A control's `disabled`, as a stylesheet and a screen reader see it.
 *
 * `disabled` is an input of the control, so it never reaches the node as a prop a selector could
 * read. What a stylesheet matches instead is the `data-disabled` state attribute the control
 * publishes, which is also what Tailwind's `disabled:` variant compiles to. Without it every
 * `disabled:` utility on a pressable compiles, ships, and never applies.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import type { StyleSheet } from '@ng-native/fabric';
import { cleanup, render } from '@ng-native/testing';
import { compileFixture } from './compile.ts';
import { build } from './tailwind-cli.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss(css: string, context: string, options?: object): StyleSheet;
};
const { flattenTailwind } = require('@ng-native/tailwind') as {
  flattenTailwind(css: string): string;
};

const GREEN = 'rgb(0, 128, 0)';
const RED = 'rgb(255, 0, 0)';
const BLUE = 'rgb(0, 0, 255)';

type Toggles = { off: { set(value: boolean): void } };

let Control: Type<Toggles>;

before(async () => {
  const mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/disabled-control.ts', import.meta.url)),
  );
  Control = mod['DisabledControl'] as Type<Toggles>;
});

after(cleanup);

describe('a disabled control publishes data-disabled', () => {
  const sheet = () =>
    compileCss(
      `
      .p { background-color: ${GREEN} }
      .p[data-disabled] { background-color: ${RED} }
      .p[data-disabled] .label { color: ${BLUE} }
      `,
      'global',
    );

  it('matches [data-disabled] however the template says disabled', async () => {
    const { getByTestId } = await render(Control, { globalStyles: sheet() });
    for (const id of ['bound', 'attribute', 'toggling', 'fade', 'switch']) {
      assert.equal(getByTestId(id).props['backgroundColor'], RED, id);
    }
    assert.equal(getByTestId('enabled').props['backgroundColor'], GREEN, 'not when enabled');
    cleanup();
  });

  it('styles what is inside a disabled control through a descendant selector', async () => {
    const { getByText } = await render(Control, { globalStyles: sheet() });
    assert.equal(getByText('Bound').props['color'], BLUE);
    cleanup();
  });

  it('keeps the style and the announced state in step when disabled changes', async () => {
    const { instance, getByTestId, rerender } = await render(Control, { globalStyles: sheet() });
    const toggling = () => getByTestId('toggling').props;
    assert.equal(toggling()['backgroundColor'], RED);
    assert.deepEqual(toggling()['accessibilityState'], { disabled: true });

    instance.off.set(false);
    await rerender();
    assert.equal(toggling()['backgroundColor'], GREEN, 'enabled again');
    assert.equal(toggling()['accessibilityState'] ?? null, null, 'and announced as enabled');

    instance.off.set(true);
    await rerender();
    assert.equal(toggling()['backgroundColor'], RED, 'and disabled once more');
    assert.deepEqual(toggling()['accessibilityState'], { disabled: true });
    cleanup();
  });
});

describe("Tailwind's disabled: variant on a pressable", () => {
  let sheet: StyleSheet;

  before(() => {
    sheet = compileCss(
      flattenTailwind(
        build(
          'native',
          'group disabled:bg-gray-300 group-disabled:text-red-500 bg-gray-300 text-red-500',
        ),
      ),
      'tailwind',
      { onUnsupported: () => {} },
    );
  });

  it('applies disabled: and group-disabled: while disabled, and drops them when not', async () => {
    const { instance, getByTestId, rerender } = await render(Control, { globalStyles: sheet });
    const background = () => getByTestId('tailwind').props['backgroundColor'];
    const label = () => getByTestId('tailwind-label').props['color'];
    // What the same utilities resolve to with no variant, so the test says nothing about how the
    // sheet carries a theme colour, only that the variant applies it.
    const gray = getByTestId('reference').props['backgroundColor'];
    const red = getByTestId('reference-label').props['color'];
    assert.ok(gray && red, 'the plain utilities resolve');
    assert.equal(background(), gray, 'disabled:');
    assert.equal(label(), red, 'group-disabled:');

    instance.off.set(false);
    await rerender();
    assert.equal(background() ?? null, null, 'enabled drops disabled:');
    assert.equal(label() ?? null, null, 'and group-disabled:');
    cleanup();
  });
});

describe('the printed tree and the queried props', () => {
  /**
   * `fabric.render({ props: true })` is how a test sees what native was sent. It printed a
   * nested prop such as `accessibilityState` as `{}`, so a disabled pressable looked as if it
   * announced nothing while the query, which reads the same commit, said disabled.
   */
  it('prints the accessibility state a query reads, nested keys and all', async () => {
    const { fabric, getByTestId } = await render(Control);
    assert.deepEqual(getByTestId('bound').props['accessibilityState'], { disabled: true });
    assert.match(
      fabric.render({ props: true }),
      /"accessibilityState":\{"disabled":true\}.*"testID":"bound"/,
    );
    cleanup();
  });
});
