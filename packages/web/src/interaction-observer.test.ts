/**
 * `InteractionEvent.component` on the web host: the component whose template holds a pressed
 * control, as `packages/integration-tests/interaction-observer.test.ts` holds the native host to.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { provideInteractionObserver, type InteractionEvent } from '@ng-native/device';
import { installJsdomEnvironment } from './jsdom-env.ts';

const down = (pointerId: number) =>
  new (globalThis as any).PointerEvent('pointerdown', { pointerId, bubbles: true });
const up = (pointerId: number) =>
  new (globalThis as any).PointerEvent('pointerup', { pointerId, bubbles: true });

/** Tap the pressable whose text is `id`, and answer what the observer heard. */
async function componentOf(id: string): Promise<InteractionEvent> {
  const { document } = installJsdomEnvironment();
  const [{ mount }, { InteractionObserverApp }] = await Promise.all([
    import('./mount.ts'),
    import('./interaction-observer-app.ts'),
  ]);
  const root = document.createElement('app-root');
  document.body.appendChild(root);
  const heard: InteractionEvent[] = [];
  const { componentRef, applicationRef } = mount(root, InteractionObserverApp, {
    providers: [provideInteractionObserver((event) => heard.push(event))],
  });
  try {
    const label = [...document.querySelectorAll('text')].find((t) => t.textContent === id)!;
    label.dispatchEvent(down(1));
    label.dispatchEvent(up(1));
    applicationRef.tick();
    await new Promise((resolve) => setTimeout(resolve));
    assert.equal(heard.length, 1);
    assert.equal(heard[0]!.testID, id);
    return heard[0]!;
  } finally {
    componentRef.destroy();
  }
}

describe('an interaction observer on the web host names the component a control belongs to', () => {
  it('reports the component whose template holds the pressable', async () => {
    const event = await componentOf('card-action');
    assert.equal(event.element, 'pressable');
    assert.equal(event.component, 'x-observed-card');
  });

  it('passes over an element that only a directive matches', async () => {
    assert.equal((await componentOf('in-region')).component, 'x-observed-card');
  });

  it('reports the innermost component, not the one around it', async () => {
    assert.equal((await componentOf('wrapped')).component, 'x-wrapped-button');
  });

  it('reports the component a pressable is projected into', async () => {
    assert.equal((await componentOf('projected')).component, 'x-observed-card');
  });

  it('reports no component for a pressable in the app component itself', async () => {
    assert.equal('component' in (await componentOf('save')), false);
  });
});
