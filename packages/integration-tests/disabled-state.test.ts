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
import { build, buildV3 } from './tailwind-cli.ts';

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

describe('a disabled text publishes data-disabled', () => {
  /**
   * `<text>` takes `disabled` from the same base as a pressable, and consumes it the same way, so
   * `:disabled` has nothing to read on it either.
   */
  it('matches [data-disabled] while disabled, and not once enabled again', async () => {
    const sheet = compileCss(
      `.p { background-color: ${GREEN} } .p[data-disabled] { background-color: ${RED} }`,
      'global',
    );
    const { instance, getByTestId, rerender } = await render(Control, { globalStyles: sheet });
    const ids = ['text', 'pressable-text'];
    for (const id of ids) assert.equal(getByTestId(id).props['backgroundColor'], RED, id);

    instance.off.set(false);
    await rerender();
    for (const id of ids) assert.equal(getByTestId(id).props['backgroundColor'], GREEN, id);

    instance.off.set(true);
    await rerender();
    for (const id of ids) assert.equal(getByTestId(id).props['backgroundColor'], RED, id);
    cleanup();
  });
});

describe('a disabled text is announced as disabled', () => {
  /**
   * React Native's `Text` puts `disabled` into `accessibilityState` whether or not it has a press
   * handler, nested or not, so VoiceOver and TalkBack say "dimmed" or "disabled" rather than
   * offering a control that does nothing.
   */
  it('commits accessibilityState.disabled, and a role query reads the same', async () => {
    const { getByRole, getByTestId } = await render(Control);
    const state = (id: string) => getByTestId(id).props['accessibilityState'];
    for (const id of ['text', 'pressable-text', 'nested-text', 'static-text']) {
      assert.deepEqual(state(id), { disabled: true }, id);
    }
    assert.deepEqual(getByRole('link', { name: 'Terms' }).props['accessibilityState'], {
      disabled: true,
    });
    cleanup();
  });

  it('follows a change both ways, merged with the state the app sets', async () => {
    const { instance, getByRole, getByTestId, rerender } = await render(Control);
    const state = (id: string) => getByTestId(id).props['accessibilityState'] ?? null;
    const link = () => getByRole('link', { name: 'Terms' }).props['accessibilityState'] ?? null;
    assert.deepEqual(state('text-with-state'), { selected: true, disabled: true });
    assert.deepEqual(state('text-both'), { disabled: true });

    instance.off.set(false);
    await rerender();
    for (const id of ['text', 'pressable-text', 'nested-text']) assert.equal(state(id), null, id);
    assert.equal(link(), null, 'the role query agrees');
    assert.deepEqual(state('text-with-state'), { selected: true }, 'the app state stays');
    assert.deepEqual(state('text-both'), { disabled: false }, 'aria-disabled says so');

    instance.off.set(true);
    await rerender();
    for (const id of ['text', 'pressable-text', 'nested-text']) {
      assert.deepEqual(state(id), { disabled: true }, id);
    }
    assert.deepEqual(link(), { disabled: true });
    assert.deepEqual(state('text-with-state'), { selected: true, disabled: true });
    cleanup();
  });
});

describe('aria-disabled publishes the attribute its selector reads', () => {
  const sheet = () =>
    compileCss(
      `
      .a { background-color: ${GREEN} }
      .a[aria-disabled="true"] { background-color: ${RED} }
      .a[aria-disabled="true"] .a-label { color: ${BLUE} }
      .s[aria-busy="true"] { opacity: 0.5 }
      .s[aria-checked="mixed"] { width: 1px }
      .s[aria-expanded="true"] { height: 2px }
      .s[aria-selected="true"] { margin-top: 3px }
      .s[aria-hidden="true"] { margin-left: 4px }
      `,
      'global',
    );

  it('matches [aria-disabled="true"] bound or static, on a control, a text and a view', async () => {
    const { getByTestId } = await render(Control, { globalStyles: sheet() });
    for (const id of ['aria', 'aria-text', 'aria-static', 'both']) {
      assert.equal(getByTestId(id).props['backgroundColor'], RED, id);
    }
    assert.equal(getByTestId('aria-false').props['backgroundColor'], GREEN, 'not when "false"');
    assert.equal(getByTestId('aria-label').props['color'], BLUE, 'a descendant rule applies');
    cleanup();
  });

  it('follows a change both ways, and announces the same state as before', async () => {
    const { instance, getByTestId, rerender } = await render(Control, { globalStyles: sheet() });
    const props = (id: string) => getByTestId(id).props;
    for (const id of ['aria', 'aria-text', 'both']) {
      assert.deepEqual(props(id)['accessibilityState'], { disabled: true }, id);
    }

    instance.off.set(false);
    await rerender();
    for (const id of ['aria', 'aria-text', 'both']) {
      assert.equal(props(id)['backgroundColor'], GREEN, `${id} enabled`);
      assert.deepEqual(props(id)['accessibilityState'], { disabled: false }, id);
    }
    assert.equal(props('aria-label')['color'] ?? null, null, 'the descendant rule lets go');

    instance.off.set(true);
    await rerender();
    for (const id of ['aria', 'aria-text', 'both']) {
      assert.equal(props(id)['backgroundColor'], RED, `${id} disabled again`);
      assert.deepEqual(props(id)['accessibilityState'], { disabled: true }, id);
    }
    cleanup();
  });

  it('publishes the other aria states Tailwind has variants for, and sends none to native', async () => {
    const { getByTestId } = await render(Control, { globalStyles: sheet() });
    const props = getByTestId('aria-states', { includeHiddenElements: true }).props;
    assert.equal(props['opacity'], 0.5, 'aria-busy');
    assert.equal(props['width'], 1, 'aria-checked');
    assert.equal(props['height'], 2, 'aria-expanded');
    assert.equal(props['marginTop'], 3, 'aria-selected');
    assert.equal(props['marginLeft'], 4, 'aria-hidden');
    assert.deepEqual(props['accessibilityState'], {
      busy: true,
      checked: 'mixed',
      expanded: true,
      selected: true,
    });
    assert.equal(props['accessibilityElementsHidden'], true);
    assert.deepEqual(
      Object.keys(props).filter((key) => key.includes('-')),
      [],
      'no attribute reaches native',
    );
    cleanup();
  });
});

describe("Tailwind's aria-disabled: and disabled: variants on a text and a control", () => {
  const classes =
    'group aria-disabled:bg-gray-300 group-aria-disabled:text-red-500 disabled:bg-gray-300 ' +
    'bg-gray-300 text-red-500';
  const builds: [string, () => string][] = [
    ['Tailwind 4', () => build('native', classes)],
    ['Tailwind 3', () => buildV3(classes)],
  ];

  for (const [name, css] of builds) {
    it(`${name}: applies while disabled, and drops when not`, async () => {
      const sheet = compileCss(flattenTailwind(css()), 'tailwind', { onUnsupported: () => {} });
      const { instance, getByTestId, rerender } = await render(Control, { globalStyles: sheet });
      const background = (id: string) => getByTestId(id).props['backgroundColor'] ?? null;
      const gray = getByTestId('reference').props['backgroundColor'];
      const red = getByTestId('reference-label').props['color'];
      assert.ok(gray && red, 'the plain utilities resolve');
      for (const id of ['aria', 'aria-text', 'aria-static', 'text']) {
        assert.equal(background(id), gray, id);
      }
      assert.equal(background('aria-false'), null, 'aria-disabled="false"');
      assert.equal(getByTestId('aria-label').props['color'], red, 'group-aria-disabled:');

      instance.off.set(false);
      await rerender();
      for (const id of ['aria', 'aria-text', 'text']) assert.equal(background(id), null, id);
      assert.equal(getByTestId('aria-label').props['color'] ?? null, null);
      cleanup();
    });
  }
});
