/**
 * The events a screen reader fires on a view: `(accessibilityAction)` for a declared action,
 * `(accessibilityTap)`, `(magicTap)` and `(accessibilityEscape)`.
 *
 * React Native's iOS view and the macOS desktop host send each one only to a view whose props say
 * something listens (`onAccessibilityAction` and its siblings, which React sets by passing the
 * handler); otherwise iOS falls back to a synthesized tap and the action never arrives. So each
 * binding commits its opt-in prop.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, fireEvent, render, screen, settle } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let Component: Type<{ heard(): string[] }>;
before(async () => {
  const mod = await compileFixture('fixtures/accessibility-events.ts');
  Component = mod['AccessibilityEvents'] as typeof Component;
});

const PROPS = [
  'onAccessibilityAction',
  'onAccessibilityTap',
  'onAccessibilityMagicTap',
  'onAccessibilityEscape',
];

it('opts the view into each accessibility event its bindings listen for', async () => {
  await render(Component);
  const props = screen.getByTestId('box').props;
  for (const prop of PROPS) assert.equal(props[prop], true, prop);
  const plain = screen.getByTestId('plain').props;
  for (const prop of PROPS) assert.equal(plain[prop], undefined, prop);
});

it('runs each binding for the event the host sends', async () => {
  const { componentRef } = await render(Component);
  const box = screen.getByTestId('box');
  await fireEvent(box, 'accessibilityAction', { actionName: 'archive' });
  await fireEvent(box, 'accessibilityTap', {});
  await fireEvent(box, 'magicTap', {});
  await fireEvent(box, 'accessibilityEscape', {});
  await settle();
  assert.deepEqual(componentRef.instance.heard(), ['action archive', 'tap', 'magicTap', 'escape']);
});
