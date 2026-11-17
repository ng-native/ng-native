/**
 * `InteractionEvent.component` on the web host: the component whose template holds a pressed
 * control, as `packages/integration-tests/interaction-observer.test.ts` holds the native host to.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { provideInteractionObserver, type InteractionEvent } from '@ng-native/device';
import type { InteractionObserverApp as ObserverApp } from './interaction-observer-app.ts';
import { installJsdomEnvironment } from './jsdom-env.ts';

const down = (pointerId: number) =>
  new (globalThis as any).PointerEvent('pointerdown', { pointerId, bubbles: true });
const up = (pointerId: number) =>
  new (globalThis as any).PointerEvent('pointerup', { pointerId, bubbles: true });

/** The app mounted with an observer, and a tap on the pressable whose text is an id. */
async function mountObserved() {
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
  /** Tap the pressable whose text is `id`, and answer what the observer heard. */
  const tap = async (id: string): Promise<InteractionEvent> => {
    heard.length = 0;
    const label = [...document.querySelectorAll('text')].find((t) => t.textContent === id)!;
    label.dispatchEvent(down(1));
    label.dispatchEvent(up(1));
    applicationRef.tick();
    await new Promise((resolve) => setTimeout(resolve));
    assert.equal(heard.length, 1);
    assert.equal(heard[0]!.testID, id);
    return heard[0]!;
  };
  /** Whether the card around the pressable whose text is `id` carries the name in the DOM. */
  const namedInDom = (id: string) => {
    const label = [...document.querySelectorAll('text')].find((t) => t.textContent === id)!;
    return label.closest('x-named-card, x-plain-card')!.hasAttribute('interactionName');
  };
  return {
    app: componentRef.instance as ObserverApp,
    applicationRef,
    tap,
    namedInDom,
    destroy: () => componentRef.destroy(),
  };
}

/** Tap the pressable whose text is `id`, and answer what the observer heard. */
async function componentOf(id: string): Promise<InteractionEvent> {
  const observed = await mountObserved();
  try {
    return await observed.tap(id);
  } finally {
    observed.destroy();
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

  it('names a component by the alternative whose attribute its host has', async () => {
    assert.equal((await componentOf('panel-action')).component, 'section[x-secondary]');
  });

  it('names a component by an alternative whose :not() its host is not ruled out by', async () => {
    assert.equal((await componentOf('banner-action')).component, 'header[x-on]');
  });

  it('names a component by the alternative whose class its host has', async () => {
    assert.equal((await componentOf('badge-action')).component, '.x-second-badge');
  });

  it('reports the name a component gives its host', async () => {
    assert.equal((await componentOf('named')).component, 'Checkout card');
  });

  it('reports no component for a pressable in the app component itself', async () => {
    assert.equal('component' in (await componentOf('save')), false);
  });
});

describe('interactionName on the web host', () => {
  it('names a component from its host and from where it is used, with no DOM attribute', async () => {
    const observed = await mountObserved();
    try {
      assert.equal((await observed.tap('named')).component, 'Checkout card');
      assert.equal(observed.namedInDom('named'), false);
      assert.equal((await observed.tap('renamed-action')).component, 'Plain renamed');
      assert.equal(observed.namedInDom('renamed-action'), false);
    } finally {
      observed.destroy();
    }
  });

  it('leaves out a component named with an empty string, with no DOM attribute', async () => {
    const observed = await mountObserved();
    try {
      assert.equal('component' in (await observed.tap('quiet-action')), false);
      assert.equal(observed.namedInDom('quiet-action'), false);
    } finally {
      observed.destroy();
    }
  });

  it('reads a bound name as it is set, changed and removed, never writing it to the DOM', async () => {
    const observed = await mountObserved();
    try {
      assert.equal((await observed.tap('bound-action')).component, 'x-plain-card');
      observed.app.boundName.set('First name');
      observed.applicationRef.tick();
      assert.equal((await observed.tap('bound-action')).component, 'First name');
      assert.equal(observed.namedInDom('bound-action'), false);
      observed.app.boundName.set('Second name');
      observed.applicationRef.tick();
      assert.equal((await observed.tap('bound-action')).component, 'Second name');
      assert.equal(observed.namedInDom('bound-action'), false);
      observed.app.boundName.set('');
      observed.applicationRef.tick();
      assert.equal('component' in (await observed.tap('bound-action')), false);
      assert.equal(observed.namedInDom('bound-action'), false);
      observed.app.boundName.set(null);
      observed.applicationRef.tick();
      assert.equal((await observed.tap('bound-action')).component, 'x-plain-card');
    } finally {
      observed.destroy();
    }
  });
});
