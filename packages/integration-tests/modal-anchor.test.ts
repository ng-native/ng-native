/**
 * `<modal [anchor]>`: a modal pointed at an element shows as a popover where the OS has them.
 *
 * The host contract: `ModalHostView` takes an `anchor` prop, the react tag of the anchor's
 * committed view. The desktop host shows the modal as an NSPopover at that view, and iPadOS as a
 * UIPopover; iPhone and Android ignore it and present as they would without it. `null` takes the
 * anchor away, so the next presentation is a sheet again.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render, screen } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

type Fixture = {
  anchored: { set(value: boolean): void };
  useButton: { set(value: boolean): void };
};
let Fixture: Type<Fixture>;

before(async () => {
  const mod = await compileFixture('fixtures/modal-anchor.ts');
  Fixture = mod['ModalAnchorFixture'] as Type<Fixture>;
});

afterEach(cleanup);

describe('a modal with an anchor', () => {
  it('commits the anchor view tag, and nothing on a modal without one', async () => {
    const app = await render(Fixture);
    await app.detectChanges();
    const pop = screen.getByTestId('pop');
    assert.equal(pop.viewName, 'ModalHostView');
    assert.equal(pop.props['anchor'], screen.getByTestId('target').reactTag);
    assert.equal('anchor' in screen.getByTestId('sheet').props, false);
  });

  it('takes a component as its anchor, by the view it renders', async () => {
    const app = await render(Fixture);
    app.instance.useButton.set(true);
    await app.detectChanges();
    assert.equal(screen.getByTestId('pop').props['anchor'], screen.getByTestId('button').reactTag);
  });

  it('commits null as the anchor goes, so native drops the one it had', async () => {
    const app = await render(Fixture);
    await app.detectChanges();
    app.instance.anchored.set(false);
    await app.detectChanges();
    assert.equal(screen.getByTestId('pop').props['anchor'], null);
  });
});
