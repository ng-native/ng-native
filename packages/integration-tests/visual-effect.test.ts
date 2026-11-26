/**
 * `<visual-effect>` is `NgNativeVisualEffect` on a desktop host, with the props `material`,
 * `blendingMode`, `state` and `emphasized`, and a plain `View` on iOS and Android, which commits
 * none of them.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, settle } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

type Fixture = {
  material: { set(value: string | undefined): void };
  emphasized: { set(value: boolean): void };
};
let Fixture: Type<Fixture>;

before(async () => {
  const mod = await compileFixture('fixtures/visual-effect.ts');
  Fixture = mod['VisualEffectFixture'] as Type<Fixture>;
});

afterEach(cleanup);

describe('on macOS', () => {
  before(() => registerPlatformComponents('macos'));
  after(() => registerPlatformComponents('ios'));

  it('commits the host view with its children inside, and its inputs as props', async () => {
    const { getByTestId } = await render(Fixture);
    const backdrop = getByTestId('backdrop');
    assert.equal(backdrop.viewName, 'NgNativeVisualEffect');
    assert.equal(backdrop.children[0], getByTestId('label'));
    assert.equal(backdrop.props['material'], 'hud-window');
    assert.equal(backdrop.props['blendingMode'], 'within-window');
    assert.equal(backdrop.props['state'], 'active');
    assert.equal(backdrop.props['emphasized'], true);
    assert.equal(backdrop.props['borderRadius'], 10);
  });

  it('sends what changes, and null for an input taken away, so the host goes back to its default', async () => {
    const { getByTestId, fixture } = await render(Fixture);
    fixture.componentInstance.material.set('sidebar');
    fixture.componentInstance.emphasized.set(false);
    await settle();
    const backdrop = getByTestId('backdrop');
    assert.equal(backdrop.props['material'], 'sidebar');
    assert.equal(backdrop.props['emphasized'], false);
    fixture.componentInstance.material.set(undefined);
    await settle();
    assert.equal(getByTestId('backdrop').props['material'], null);
    const plain = getByTestId('plain');
    assert.equal(plain.viewName, 'NgNativeVisualEffect');
    // Nothing set: the host's defaults, with no value committed on the first commit.
    assert.equal(plain.props['material'] ?? null, null);
    assert.equal(plain.props['blendingMode'] ?? null, null);
  });
});

describe('on iOS', () => {
  it('is a plain view that commits none of the material props', async () => {
    const { getByTestId } = await render(Fixture);
    const backdrop = getByTestId('backdrop');
    assert.equal(backdrop.viewName, 'View');
    assert.equal(backdrop.props['material'], undefined);
    assert.equal(backdrop.props['blendingMode'], undefined);
    assert.equal(backdrop.props['state'], undefined);
    assert.equal(backdrop.props['emphasized'], undefined);
    assert.equal(backdrop.props['backgroundColor'] !== undefined, true);
  });
});
