/**
 * A numeric router input bound to `null` is unset, as one bound to `undefined` is.
 * `numberAttribute(null)` is NaN, which would otherwise reach native as a font size or a spacer's
 * width. `[spacing]` on `<native-header-item>` is pinned in router-header-bar-menus.test.ts.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render } from '@ng-native/testing';
import { registerScreenComponents } from '../router/src/screens.ts';
import { compileFixture } from './compile.ts';

interface Host {
  readonly size: WritableSignal<number | null | undefined>;
}

const ITEM = 'ViewManagerAdapter_ExpoRouterToolbarModule_RouterToolbarItemView';

const inputs = [
  { name: 'titleFontSize', view: 'RNSScreenStackHeaderConfig' },
  { name: 'largeTitleFontSize', view: 'RNSScreenStackHeaderConfig' },
  { name: 'backTitleFontSize', view: 'RNSScreenStackHeaderConfig' },
  { name: 'width', view: ITEM },
] as const;

describe('numeric router inputs bound to null', () => {
  let Numbered: Type<Host>;
  let Nulled: Type<Host>;

  before(async () => {
    registerScreenComponents();
    const mod = await compileFixture('fixtures/router-number-inputs.ts');
    Numbered = mod['RouterNumberInputs'] as Type<Host>;
    Nulled = mod['RouterNumberInputsNull'] as Type<Host>;
  });

  afterEach(() => cleanup());
  after(() => {
    registerPlatformComponents('ios');
    registerScreenComponents();
  });

  for (const { name, view } of inputs) {
    describe(name, () => {
      it('commits the number bound', async () => {
        const app = await render(Numbered);
        assert.equal(app.fabric.find(view)!.props[name], 12);
      });

      it('sends nothing for null bound from the first pass', async () => {
        const app = await render(Nulled);
        assert.equal(app.fabric.find(view)!.props[name], undefined);
      });

      it('clears the number when the binding turns null, and takes a number again', async () => {
        const app = await render(Numbered);
        const host = app.instance as Host;
        host.size.set(null);
        await app.detectChanges();
        assert.equal(app.fabric.find(view)!.props[name], null);
        host.size.set(16);
        await app.detectChanges();
        assert.equal(app.fabric.find(view)!.props[name], 16);
      });
    });
  }
});
