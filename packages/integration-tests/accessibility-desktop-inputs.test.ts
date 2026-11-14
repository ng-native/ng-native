/**
 * The accessibility inputs the desktop host reads, in both spellings, as `accessibilityLabel` and
 * `aria-label` are: a heading's level, the views that describe this one, whether a field is
 * required or invalid, an item's place in its set, and a grid's row and column counts. Each is
 * committed as the `accessibility*` prop, on a primitive and on the host of an app's own
 * component alike, and the native spelling wins where both are written.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

type Fixture = { invalid: { set(value: boolean): void } };
let app: Awaited<ReturnType<typeof render<Fixture>>>;
const node = (id: string): FakeFabricNode => app.getByTestId(id);

before(async () => {
  const mod = await compileFixture('fixtures/accessibility-desktop-inputs.ts');
  app = await render(mod['AccessibilityDesktopInputs'] as Type<Fixture>);
});

after(cleanup);

const COMMITTED = {
  accessibilityLevel: 2,
  accessibilityDescribedBy: ['hint', 'error'],
  accessibilityRequired: true,
  accessibilityInvalid: true,
  accessibilityPosInSet: 3,
  accessibilitySetSize: 10,
  accessibilityRowCount: 5,
  accessibilityColumnCount: 4,
};

const committed = (id: string) =>
  Object.fromEntries(Object.keys(COMMITTED).map((key) => [key, node(id).props[key]]));

describe('the desktop accessibility inputs', () => {
  it('commit their props from the native spelling', () => {
    assert.deepEqual(committed('native'), COMMITTED);
  });

  it('commit the same props from the web spelling', () => {
    assert.deepEqual(committed('web'), COMMITTED);
  });

  it('take the native spelling over the web one where both are written', () => {
    assert.equal(node('both').props['accessibilityLevel'], 1);
  });

  it("commit from the web spelling on the host of an app's own component", () => {
    assert.deepEqual(committed('host'), {
      accessibilityLevel: 2,
      accessibilityDescribedBy: ['hint'],
      accessibilityRequired: true,
      accessibilityInvalid: false,
      accessibilityPosInSet: 1,
      accessibilitySetSize: 2,
      accessibilityRowCount: 7,
      accessibilityColumnCount: 3,
    });
  });

  it('follow a bound value as it changes', async () => {
    app.fixture.componentInstance.invalid.set(false);
    await settle();
    assert.equal(node('native').props['accessibilityInvalid'], false);
  });
});
