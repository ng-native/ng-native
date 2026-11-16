/**
 * Claiming a host and taking off the attributes an input already consumed, shared by the
 * components and the router: `<view role="button">` feeds the input *and* writes a `role`
 * attribute, and only what the input writes should reach the native view.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { ElementRef, Signal, Type } from '@angular/core';
import { ownHost } from '@ng-native/device';
import { cleanup, render, screen } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

type Hosts = Record<'view' | 'component' | 'behaviour', Signal<ElementRef>>;

describe('a host primitive', () => {
  let mod: Record<string, Type<unknown>>;
  let hosts: Hosts;
  const props = (name: keyof Hosts) =>
    (hosts[name]().nativeElement as { props: Record<string, unknown> }).props;

  before(async () => {
    mod = (await compileFixture('fixtures/own-host.ts')) as Record<string, Type<unknown>>;
    hosts = (await render(mod['OwnedHosts']!)).instance as Hosts;
  });

  after(cleanup);

  it('loses the attributes a directive with a selector consumed, and keeps the rest', () => {
    assert.equal(props('view')['role'], undefined);
    assert.equal(props('view')['caption'], 'kept');
    // `role="button"` is no ARIA-only role, so what the native view is sent is the native one.
    const committed = screen.getByTestId('view', { includeHiddenElements: true }).props;
    assert.equal(committed['role'], undefined);
    assert.equal(committed['accessibilityRole'], 'button');
  });

  it('loses the attributes a component consumed, by the name a template writes', () => {
    assert.equal(props('component')['caption'], undefined, 'the aliased input');
    assert.equal(props('component')['role'], undefined, 'an inherited input');
    assert.equal(props('component')['heading'], 'kept');
  });

  it('keeps the attributes a directive with no selector did not consume', () => {
    // `PressBehavior` only takes the inputs its host lists, and this one lists none, so
    // `delayPressIn` here is an attribute of the host component's, not an input's.
    assert.equal(props('behaviour')['delayPressIn'], 'kept');
  });
});

describe('ownHost', () => {
  let mod: Record<string, Type<unknown>>;

  before(async () => {
    mod = (await compileFixture('fixtures/own-host.ts')) as Record<string, Type<unknown>>;
  });

  it("takes a directive's inputs off, as a component's", () => {
    const node = { props: { title: 'Inbox', testID: 'bar' } };
    ownHost(node, mod['OwnedDirective']);
    assert.deepEqual(node.props, { testID: 'bar' });
  });

  it('claims a node with no props yet, and a class Angular does not know, without throwing', () => {
    const bare = {};
    assert.equal(ownHost(bare, mod['Owned']), bare);
    assert.equal((bare as { claimed?: true }).claimed, true);
    const node = { props: { title: 'Inbox' } };
    ownHost(node);
    ownHost(node, class Plain {});
    assert.deepEqual(node.props, { title: 'Inbox' });
    assert.equal((node as { claimed?: true }).claimed, true);
  });

  it('leaves the attributes of a directive with no selector alone', () => {
    const node = { props: { title: 'Inbox' } };
    ownHost(node, mod['OwnedBehavior']);
    assert.deepEqual(node.props, { title: 'Inbox' });
  });

  it("reads a component's inputs again once a hot reload replaced its definition", () => {
    const def = (mod['Owned'] as unknown as { ɵcmp: { inputs: Record<string, unknown> } }).ɵcmp;
    const inputs = def.inputs;
    ownHost({ props: {} }, mod['Owned']);
    try {
      // What Angular's `ɵɵreplaceMetadata` does: the definition merged in place, new inputs in it.
      Object.assign(def, { inputs: { ...inputs, subtitle: ['subtitle', 0, null] } });
      const node = { props: { subtitle: 'Today', testID: 'bar' } };
      ownHost(node, mod['Owned']);
      assert.deepEqual(node.props, { testID: 'bar' });
    } finally {
      Object.assign(def, { inputs });
    }
  });
});
