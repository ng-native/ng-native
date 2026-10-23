/**
 * What `<touchable-opacity>` returns to after a press. React Native's `TouchableOpacity` eases back
 * to the opacity its own style gives it, read when the press ends. Here a class is the commonest
 * way to give one, so the cascade decides it: a component sheet's class, a global sheet's
 * (Tailwind's), an inline `[style]` and a bound `[style.opacity]` alike. A component that read
 * only the inline style eased a class-dimmed one up to 1 after every press, and then back down.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import {
  cleanup,
  compileCss,
  fireEvent,
  render,
  settle,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';
import { build } from './tailwind-cli.ts';

interface Resting {
  dim: { set(value: string): void };
  mapped: { set(value: number | undefined): void };
  bound: { set(value: number | undefined): void };
}

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

const IDS = ['class', 'map', 'bound', 'tailwind'] as const;

describe('touchable-opacity returns to the opacity the cascade gives it', () => {
  let Component: Type<Resting>;
  let tailwind: string;
  let fabric: FakeFabric;
  let instance: Resting;
  let engine: Engine;
  let now: number;

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/touchable-resting.ts', import.meta.url)),
    );
    Component = mod['TouchableResting'] as Type<Resting>;
    tailwind = build('native', 'opacity-50');
  });

  beforeEach(async () => {
    now = 1000;
    const rendered = await render<Resting>(Component, {
      now: () => now,
      globalStyles: compileCss(tailwind, 'app.css') as never,
    });
    fabric = rendered.fabric;
    instance = rendered.instance;
    engine = rendered.componentRef.injector.get(Engine);
    // A view no frame has shown yet starts no transition.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  afterEach(() => cleanup());
  after(() => cleanup());

  const node = (id: string) => flatten(fabric.committed).find((n) => n.props['testID'] === id)!;
  // An opacity nothing sets is never sent, and one taken away is sent as `null`: native's own
  // default, 1, either way.
  const opacity = (id: string) => (node(id).props['opacity'] ?? 1) as number;

  /** Steps the engine's clock by `ms` in frames, and hands back every opacity committed. */
  const run = (id: string, ms: number): number[] => {
    const seen: number[] = [];
    for (let at = 0; at < ms; at += 25) {
      now += 25;
      engine.advanceAnimations();
      engine.commit();
      seen.push(opacity(id));
    }
    return seen;
  };

  const pressIn = async (id: string) => {
    await fireEvent(node(id), 'touchStart');
    run(id, 150);
  };

  /** Held past `minPressDuration` (130ms, a real timer), so the release is not deferred. */
  const release = async (id: string) => {
    await new Promise((resolve) => setTimeout(resolve, 140));
    await fireEvent(node(id), 'touchEnd');
  };

  /** Lets a fade out run to its end and the component let go, and the opacities on the way. */
  const fadeOut = async (id: string): Promise<number[]> => {
    const seen = run(id, 300);
    await settle();
    seen.push(...run(id, 300));
    await settle();
    seen.push(opacity(id));
    return seen;
  };

  for (const id of IDS) {
    it(`eases back to 0.5 and no further, given it by ${id}`, async () => {
      assert.equal(opacity(id), 0.5, 'at rest');
      await pressIn(id);
      assert.equal(opacity(id), 0.2, 'pressed');
      await release(id);
      const seen = await fadeOut(id);
      assert.ok(
        seen.every((value) => value >= 0.2 - 1e-9 && value <= 0.5 + 1e-9),
        `never past 0.5 on the way back: ${seen.join(', ')}`,
      );
      assert.equal(seen.at(-1), 0.5, 'back to rest');
    });
  }

  it('dims to its own activeOpacity beside an inline [style] opacity', async () => {
    assert.equal(opacity('active'), 0.5, 'at rest');
    await pressIn('active');
    assert.equal(opacity('active'), 0.3, 'pressed');
    await release('active');
    const seen = await fadeOut('active');
    assert.equal(seen.at(-1), 0.5, 'back to rest');
  });

  it('returns to a class that changed while it was pressed', async () => {
    await pressIn('class');
    instance.dim.set('quarter');
    await settle();
    assert.equal(opacity('class'), 0.2, 'still pressed');
    await release('class');
    const seen = await fadeOut('class');
    assert.ok(
      seen.every((value) => value <= 0.25 + 1e-9),
      `never past 0.25: ${seen.join(', ')}`,
    );
    assert.equal(seen.at(-1), 0.25);
  });

  it('returns to a class that changed while it was fading back', async () => {
    await pressIn('class');
    await release('class');
    const there = run('class', 100).at(-1)!;
    assert.ok(there > 0.25 && there < 0.5, `part of the way back: ${there}`);
    instance.dim.set('quarter');
    await settle();
    const seen = await fadeOut('class');
    // Turned towards the new class from where it had got to, not carried on to the old one first.
    assert.ok(
      seen.every((value) => value <= there + 1e-9),
      `never back up past ${there}: ${seen.join(', ')}`,
    );
    assert.equal(seen.at(-1), 0.25, 'settles on the new class');
  });

  it('returns to 1 once the class giving it an opacity is gone', async () => {
    await pressIn('class');
    instance.dim.set('');
    await settle();
    await release('class');
    // Within the one 250ms fade, rather than to the old class's 0.5 first and on from there.
    assert.equal(run('class', 275).at(-1), 1, 'there in one fade');
    const seen = await fadeOut('class');
    assert.equal(seen.at(-1), 1, 'and stays');
  });

  it('returns to an inline opacity that changed while it was pressed, or went away', async () => {
    await pressIn('map');
    instance.mapped.set(0.25);
    await settle();
    await release('map');
    let seen = await fadeOut('map');
    assert.ok(
      seen.every((value) => value <= 0.25 + 1e-9),
      `never past 0.25: ${seen.join(', ')}`,
    );
    assert.equal(seen.at(-1), 0.25);

    await pressIn('map');
    instance.mapped.set(undefined);
    await settle();
    await release('map');
    seen = await fadeOut('map');
    assert.equal(seen.at(-1), 1, 'the inline opacity gone, nothing sets one');
  });

  it('returns to a bound opacity that changed while it was pressed', async () => {
    await pressIn('bound');
    instance.bound.set(0.25);
    await settle();
    await release('bound');
    const seen = await fadeOut('bound');
    assert.ok(
      seen.every((value) => value <= 0.25 + 1e-9),
      `never past 0.25: ${seen.join(', ')}`,
    );
    assert.equal(seen.at(-1), 0.25);
  });
});
