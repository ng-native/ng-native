/**
 * The web's spellings of accessibility, `role` and `aria-*`, on any element that commits a view.
 *
 * `role` takes the ARIA roles and is committed as native's own `role` prop, which each platform
 * maps to what it has: React Native's `View.js` passes it straight through, and native reads it
 * over `accessibilityRole`. The `aria-*` attributes are mapped as `View.js` maps them, on the host
 * of an app's own component as on a `<view>`, since a label that is dropped fails silently for
 * exactly the people who cannot see that it is missing.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import type { Role } from '@ng-native/components';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

let app: Awaited<ReturnType<typeof render<{ label: { set(value: string | undefined): void } }>>>;
const node = (id: string): FakeFabricNode => app.getByTestId(id);

before(async () => {
  const mod = await compileFixture('fixtures/aria-anywhere.ts');
  app = await render(
    mod['AriaAnywhere'] as Type<{ label: { set(value: string | undefined): void } }>,
  );
});

after(cleanup);

describe('role', () => {
  it('takes the ARIA roles, which accessibilityRole has no word for', () => {
    const roles: Role[] = ['row', 'cell', 'columnheader', 'table', 'listitem', 'dialog', 'heading'];
    assert.equal(roles.length, 7);
  });

  it('is committed as the role prop, for native to map', () => {
    assert.equal(node('row').props['role'], 'row');
    assert.equal(node('row').props['accessibilityRole'], undefined);
  });

  it('is still accessibilityRole for a value only that has, as before', () => {
    assert.equal(node('legacy').props['accessibilityRole'], 'header');
    assert.equal(node('legacy').props['role'], undefined);
  });

  it('is committed beside an accessibilityRole, which native reads it over', () => {
    assert.equal(node('both').props['role'], 'listitem');
    assert.equal(node('both').props['accessibilityRole'], 'button');
  });

  it('is found by getByRole, with accessibilityRole', () => {
    const items = app.getAllByRole('listitem').map((found) => found.props['testID']);
    assert.deepEqual(items, ['item', 'both']);
    assert.equal(app.getByRole('button').props['testID'], 'both');
    assert.equal(app.getByRole('listitem', { name: 'First' }).props['testID'], 'item');
  });
});

describe("role and aria-* on the host of an app's own component", () => {
  it('reads the role and the label, so the host is found as a view would be', () => {
    assert.equal(node('host').props['role'], 'list');
    assert.equal(node('host').props['accessibilityLabel'], 'Tags');
    assert.equal(app.getByRole('list', { name: 'Tags' }).props['testID'], 'host');
  });

  it('maps aria-live as View.js does', () => {
    assert.equal(node('host').props['accessibilityLiveRegion'], 'polite');
  });

  it('hides an aria-hidden host from a screen reader, and so from a query', () => {
    assert.throws(() => node('hidden'), /Unable to find/);
    const { props } = app.getByTestId('hidden', { includeHiddenElements: true });
    assert.equal(props['accessibilityElementsHidden'], true);
    assert.equal(props['importantForAccessibility'], 'no-hide-descendants');
  });

  it('gathers the state and the value attributes into the objects native takes', () => {
    const { props } = node('state');
    assert.deepEqual(props['accessibilityState'], { checked: 'mixed', disabled: true });
    assert.deepEqual(props['accessibilityValue'], { max: 10, now: 3 });
  });

  it('leaves out a value that is not a number, rather than send NaN', () => {
    assert.equal(node('unread').props['accessibilityValue'], undefined);
  });

  it('never sends the attribute itself', () => {
    const sent = Object.keys(node('host').props).filter((key) => key.includes('-'));
    assert.deepEqual(sent, []);
  });

  it('follows a bound aria-label, and drops the label when the binding does', async () => {
    assert.equal(node('state').props['accessibilityLabel'], 'Bound');
    app.instance.label.set('Again');
    await settle();
    assert.equal(node('state').props['accessibilityLabel'], 'Again');
    app.instance.label.set(undefined);
    await settle();
    assert.equal(node('state').props['accessibilityLabel'] ?? undefined, undefined);
  });

  it("leaves the element's own accessibilityLabel over an aria-label", () => {
    assert.equal(node('own').props['accessibilityLabel'], 'Own');
  });
});
