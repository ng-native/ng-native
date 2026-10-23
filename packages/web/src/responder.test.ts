/**
 * The responder negotiation (`responder.ts`), against a real nested tree: a pressable inside a
 * scroll view inside another pressable, mounted through `mount` and driven with real
 * `PointerEvent`s and a real `scroll` event - the scenario the task calls the hard part, and the
 * one `examples/web-button`'s prototype explicitly did not attempt (see its `browser-engine.ts`
 * doc comment: "there is exactly one control on this page").
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SyntheticEvent } from '@ng-native/fabric';
import type { BrowserNode } from './dom-node.ts';
import type { NestedPressApp } from './responder-app.ts';
import { ResponderSystem } from './responder.ts';
import { installJsdomEnvironment } from './jsdom-env.ts';

async function bootstrapNested() {
  const { document } = installJsdomEnvironment();
  const [{ mount }, { NestedPressApp }] = await Promise.all([
    import('./mount.ts'),
    import('./responder-app.ts'),
  ]);
  const root = document.createElement('app-root');
  document.body.appendChild(root);
  const { componentRef, applicationRef } = mount(root, NestedPressApp);
  return {
    document,
    componentRef,
    applicationRef,
    app: componentRef.instance as NestedPressApp,
  };
}

const down = (pointerId: number) =>
  new (globalThis as any).PointerEvent('pointerdown', { pointerId, bubbles: true });
const up = (pointerId: number) =>
  new (globalThis as any).PointerEvent('pointerup', { pointerId, bubbles: true });

describe('responder negotiation, over a real nested tree', () => {
  it('elects only the innermost pressable, not the one wrapping the whole page', async () => {
    const { document, componentRef, applicationRef: appRef, app } = await bootstrapNested();
    const innerText = [...document.querySelectorAll('text')].find(
      (t) => t.textContent === 'inner',
    )!;

    innerText.dispatchEvent(down(1));
    innerText.dispatchEvent(up(1));
    appRef.tick();

    assert.deepEqual(
      app.log(),
      ['inner'],
      'raw propagation would have fired both pressables; the negotiation elects exactly one',
    );

    componentRef.destroy();
  });

  it('lets a scroll view take the gesture over a press started inside it', async () => {
    const { document, componentRef, applicationRef: appRef, app } = await bootstrapNested();
    const innerText = [...document.querySelectorAll('text')].find(
      (t) => t.textContent === 'inner',
    )!;
    const scrollView = document.querySelector('scroll-view')!;

    innerText.dispatchEvent(down(2));
    // The scroll view moved under the finger - `notifyScroll` (`browser-engine.ts`'s `wireScroll`
    // listener) should terminate the inner pressable's grant before the finger lifts.
    scrollView.dispatchEvent(new (globalThis as any).Event('scroll', { bubbles: false }));
    innerText.dispatchEvent(up(2));
    appRef.tick();

    assert.deepEqual(
      app.log(),
      [],
      'the press was cancelled; (press) never fires for either pressable',
    );

    componentRef.destroy();
  });

  it('still presses normally when nothing scrolls', async () => {
    const { document, componentRef, applicationRef: appRef, app } = await bootstrapNested();
    const outerText = [...document.querySelectorAll('text')].find(
      (t) => t.textContent === 'outer',
    )!;

    outerText.dispatchEvent(down(3));
    outerText.dispatchEvent(up(3));
    appRef.tick();

    assert.deepEqual(app.log(), ['outer']);

    componentRef.destroy();
  });
});

describe('responder negotiation on a move', () => {
  /** Nodes as the negotiation reads them: only the parent chain matters to it. */
  const tree = () => {
    const outer = { parent: null } as unknown as BrowserNode;
    const inner = { parent: outer } as unknown as BrowserNode;
    const leaf = { parent: inner } as unknown as BrowserNode;
    const sibling = { parent: outer } as unknown as BrowserNode;
    return { outer, inner, leaf, sibling };
  };
  const event = new SyntheticEvent({});

  it('hands a drag to an ancestor that claims a move, terminating the responder', () => {
    const { outer, inner } = tree();
    const log: string[] = [];
    const system = new ResponderSystem();
    system.setResponder(inner, {
      onStartShouldSetResponder: () => true,
      onResponderGrant: () => log.push('inner:grant'),
      onResponderTerminate: () => log.push('inner:terminate'),
    });
    system.setResponder(outer, {
      onMoveShouldSetResponderCapture: () => true,
      onResponderGrant: () => log.push('outer:grant'),
      onResponderMove: () => log.push('outer:move'),
    });

    system.runResponder(inner, 'topTouchStart', event);
    system.runResponder(inner, 'topTouchMove', event);

    assert.equal(system.responder, outer);
    assert.deepEqual(log, ['inner:grant', 'inner:terminate', 'outer:grant', 'outer:move']);
  });

  it('asks only above the responder, from what it and the target are both in', () => {
    const { outer, inner, leaf, sibling } = tree();
    let asked = 0;
    const system = new ResponderSystem();
    system.setResponder(inner, { onStartShouldSetResponder: () => true });
    system.setResponder(leaf, { onMoveShouldSetResponder: () => (asked++, true) });
    system.setResponder(outer, { onMoveShouldSetResponder: () => true });

    system.runResponder(inner, 'topTouchStart', event);
    system.runResponder(leaf, 'topTouchMove', event);
    assert.equal(system.responder, outer);
    assert.equal(asked, 0, 'the leaf inside the responder is never asked');

    system.runResponder(inner, 'topTouchEnd', event);
    system.runResponder(inner, 'topTouchStart', event);
    system.runResponder(sibling, 'topTouchMove', event);
    assert.equal(system.responder, outer, 'and a finger on a sibling asks what both are in');
  });
});
