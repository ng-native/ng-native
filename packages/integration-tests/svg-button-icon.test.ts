/**
 * A `ButtonIcon` written as an icon's SVG markup, `{ svg }`, on `<sidebar-item>` and
 * `<native-button>`. The macOS and Linux hosts draw it as their own icon, from the `svgIcon` prop:
 * a template image AppKit tints, and a symbolic icon GTK draws in the text colour. Elsewhere it is
 * no icon, and a button says so once in development.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, settle } from '@ng-native/testing';
import type { ButtonIcon } from '@ng-native/components';
import { compileFixture } from './compile.ts';

type Fixture = { icon: WritableSignal<ButtonIcon> };
let Fixture: Type<Fixture>;
let blocks: string;

before(async () => {
  const mod = await compileFixture('fixtures/svg-button-icon.ts');
  Fixture = mod['SvgButtonIconFixture'] as Type<Fixture>;
  blocks = mod['blocks'] as string;
});

let warned: string[] = [];
const warn = console.warn;
beforeEach(() => {
  warned = [];
  console.warn = (message: unknown) => void warned.push(String(message));
});
afterEach(() => {
  console.warn = warn;
  cleanup();
  registerPlatformComponents('ios');
});

for (const os of ['macos', 'linux'] as const) {
  describe(`on ${os}`, () => {
    beforeEach(() => registerPlatformComponents(os));

    it('commits the markup as svgIcon on the row and the button, and takes it away for a symbol', async () => {
      const { instance, getByTestId, rerender } = await render(Fixture);
      for (const id of ['skills', 'add']) {
        assert.equal(getByTestId(id).props['svgIcon'], blocks, id);
        assert.equal(getByTestId(id).props['sfSymbol'], undefined, id);
      }
      assert.deepEqual(warned, []);

      instance.icon.set({ sfSymbol: 'star' });
      await rerender();
      for (const id of ['skills', 'add']) {
        assert.equal(getByTestId(id).props['sfSymbol'], 'star', id);
        assert.equal(getByTestId(id).props['svgIcon'], null, `${id}: removed, not left as it was`);
      }
    });

    it("says once when the markup is the icon's name, which draws nothing", async () => {
      const { instance, rerender } = await render(Fixture);
      instance.icon.set({ svg: `lucideBlocks${os}` });
      await rerender();
      await settle();
      const said = warned.filter((message) => message.includes(`lucideBlocks${os}`));
      assert.equal(said.length, 1, warned.join('\n'));
      assert.match(said[0]!, /not its name/);
    });
  });
}

describe('on iOS', () => {
  it('commits no icon for a drawn row, and says once that a button shows none there', async () => {
    registerPlatformComponents('ios');
    const { getByTestId } = await render(Fixture);
    assert.equal(getByTestId('skills').props['svgIcon'], undefined, 'a row drawn here');
    assert.equal(getByTestId('add').props['svgIcon'], blocks);
    const said = warned.filter((message) => message.includes('macOS and Linux only'));
    assert.equal(said.length, 1, warned.join('\n'));
    assert.match(said[0]!, /<native-button>/);
  });
});
