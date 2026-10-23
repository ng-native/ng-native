/**
 * `element.getAnimations()` as the Web Animations API has it: a library reads how far an
 * animation has got and how long it runs, waits on `finished` before it takes a leaving element
 * away, and holds an exit at its last frame with `updateTiming({ fill: 'forwards' })`.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, ElementRef, inject } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { cleanup, compileCss, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** Each test's clock run on past anything it left playing, before its app goes. */
let runOut: (() => void) | undefined;
afterEach(() => {
  runOut?.();
  runOut = undefined;
  cleanup();
});

/** What a library sees of an element: loosely typed, as its own code would be against the DOM. */
type Dom = any;

@Component({
  selector: 'x-pane',
  template: `<div class="pane" testID="pane"><div class="row" testID="row"></div></div>`,
})
class Pane {
  readonly host: Dom = inject(ElementRef).nativeElement;
}

const CSS = `
  @keyframes exit { from { opacity: 1 } to { opacity: 0 } }
  @keyframes spin { to { transform: rotate(360deg) } }
  .out { animation: exit 100ms linear }
  .kept { animation: exit 100ms linear forwards }
  .twice { animation: exit 100ms linear 50ms 2 }
  .spins { animation: spin 100ms linear infinite }
  .fades { opacity: 1; transition: opacity 100ms linear }
  .fades.gone { opacity: 0 }
`;

/** A pane on a clock the test moves, and what a library holds of it. */
async function pane() {
  let now = 1000;
  const app = await render(Pane, {
    providers: [provideWebCompat()],
    globalStyles: compileCss(CSS, 'global') as never,
    now: () => now,
  });
  await settle();
  const engine = app.componentRef.injector.get(Engine);
  const host = app.instance.host;
  // The clock stands still for the frames a platform plays: one left running never ends.
  runOut = () => {
    now += 60_000;
    engine.advanceAnimations();
  };
  return {
    app,
    pane: host.querySelector('.pane') as Dom,
    row: host.querySelector('.row') as Dom,
    /** Move the clock on, and play the frame there. */
    async tick(ms: number) {
      now += ms;
      engine.advanceAnimations();
      engine.commit();
      await settle();
    },
  };
}

/** How a promise has settled so far: read after the microtasks it settles in have run. */
function watch(promise: Promise<unknown>): { readonly state: string; readonly value: unknown } {
  const seen = { state: 'pending', value: undefined as unknown };
  promise.then(
    (value) => Object.assign(seen, { state: 'fulfilled', value }),
    (error: Error) => Object.assign(seen, { state: `rejected: ${error.name}`, value: error }),
  );
  return seen;
}

describe('getAnimations', () => {
  it('answers for an @keyframes animation with how far it has got, and settles when it ends', async () => {
    const s = await pane();
    s.row.classList.add('out');
    await settle();
    const [animation] = s.row.getAnimations();
    assert.equal(animation.animationName, 'exit');
    assert.equal(animation.playState, 'running');
    assert.equal(s.row.getAnimations()[0], animation, 'the same animation each time it is asked');
    assert.equal(animation.effect.target, s.row);
    assert.deepEqual(animation.effect.getTiming(), { duration: 100, delay: 0, iterations: 1 });
    const finished = watch(animation.finished);

    await s.tick(40);
    const timing = animation.effect.getComputedTiming();
    assert.equal(timing.progress, 0.4);
    assert.equal(timing.currentIteration, 0);
    assert.equal(timing.activeDuration, 100);
    assert.equal(timing.endTime, 100);
    assert.equal(timing.localTime, 40);
    assert.equal(finished.state, 'pending', 'not before it has run');

    await s.tick(70);
    assert.equal(finished.state, 'fulfilled');
    assert.equal(finished.value, animation, 'with the animation, as a browser resolves it');
    assert.equal(animation.playState, 'finished');
    assert.equal(animation.effect.getComputedTiming().progress, null, 'no fill holds it');
    assert.equal(s.row.listeners?.has('topAnimationend') ?? false, false, 'nothing left heard');
  });

  it('counts the iterations and the delay, and reads the last frame of one it holds', async () => {
    const s = await pane();
    s.row.classList.add('twice');
    await settle();
    const [animation] = s.row.getAnimations();
    let timing = animation.effect.getComputedTiming();
    assert.equal(timing.progress, null, 'in its delay, which nothing fills');
    assert.equal(timing.activeDuration, 200);
    assert.equal(timing.endTime, 250);
    await s.tick(175);
    timing = animation.effect.getComputedTiming();
    assert.equal(timing.currentIteration, 1);
    assert.equal(timing.progress, 0.25);
    animation.effect.updateTiming({ fill: 'forwards' });
    assert.equal(animation.effect.getComputedTiming().fill, 'forwards');
    await s.tick(100);
    timing = animation.effect.getComputedTiming();
    assert.equal(timing.progress, 1, 'the end of its last iteration');
    assert.equal(timing.currentIteration, 1);
  });

  it('holds an animation at its last frame once updateTiming asks for a forwards fill', async () => {
    // A dialog that closes holds each exit there, so nothing snaps back before it is taken away.
    const s = await pane();
    s.row.classList.add('out');
    await settle();
    const [animation] = s.row.getAnimations();
    animation.effect.updateTiming({ fill: 'forwards' });
    await s.tick(120);
    assert.equal(animation.playState, 'finished');
    assert.equal(screen.getByTestId('row').props['opacity'], 0, 'held where it ended');
    assert.equal(s.row.getAnimations()[0] === animation, true, "and still the element's");
  });

  it('lets go of a held last frame when the fill is taken off after it has finished', async () => {
    const s = await pane();
    s.row.classList.add('out');
    await settle();
    const [animation] = s.row.getAnimations();
    animation.effect.updateTiming({ fill: 'forwards' });
    await s.tick(120);
    assert.equal(screen.getByTestId('row').props['opacity'], 0, 'held where it ended');
    animation.effect.updateTiming({ fill: 'none' });
    await s.tick(0);
    assert.equal(screen.getByTestId('row').props['opacity'] ?? 1, 1, 'back at rest');
    assert.equal(s.row.getAnimations().length, 0, 'and no longer listed');
  });

  it('is another animation once it is started again, at the same time as the last', async () => {
    // The clock stands still: what tells two runs apart is that the second is a new one.
    const s = await pane();
    s.row.classList.add('out');
    await settle();
    const [first] = s.row.getAnimations();
    s.row.classList.remove('out');
    await settle();
    s.row.classList.add('out');
    await settle();
    const [second] = s.row.getAnimations();
    assert.equal(first !== undefined && second !== undefined, true, 'both runs are there');
    assert.equal(second !== first, true, 'a new animation');
  });

  it('is the same animation once the engine plays it on from a copy of its record', async () => {
    // As it does where native laid an animation out and it goes on in JavaScript.
    const s = await pane();
    s.row.classList.add('out');
    await settle();
    const [animation] = s.row.getAnimations();
    s.row.playing = { ...s.row.playing };
    const [again] = s.row.getAnimations();
    assert.equal(again === animation, true, 'the same animation');
  });

  it("is still the element's once it has finished, where its own fill holds its last frame", async () => {
    const s = await pane();
    s.row.classList.add('kept');
    await settle();
    const [animation] = s.row.getAnimations();
    await s.tick(120);
    const after = s.row.getAnimations();
    assert.equal(after.length, 1, 'still there');
    assert.equal(after[0] === animation, true, 'the same animation');
    assert.equal(after[0].playState, 'finished');
    // And not one that ends with nothing held.
    s.row.classList.remove('kept');
    s.row.classList.add('out');
    await settle();
    await s.tick(120);
    assert.equal(s.row.getAnimations().length, 0, 'none held');
  });

  it('lets one go at its end again once updateTiming takes the fill back off', async () => {
    const s = await pane();
    s.row.classList.add('out');
    await settle();
    const [animation] = s.row.getAnimations();
    animation.effect.updateTiming({ fill: 'both' });
    animation.effect.updateTiming({ fill: 'none' });
    await s.tick(120);
    assert.equal(screen.getByTestId('row').props['opacity'] ?? 1, 1, 'back at rest');
  });

  it('rejects finished with an AbortError when the element stops asking for the animation', async () => {
    const s = await pane();
    s.row.classList.add('out');
    await settle();
    const [animation] = s.row.getAnimations();
    const finished = watch(animation.finished);
    await s.tick(20);
    s.row.classList.remove('out');
    await settle();
    assert.equal(finished.state, 'rejected: AbortError');
    assert.equal(animation.playState, 'idle');
    assert.equal(animation.effect.getComputedTiming().progress, null);
  });

  it('rejects finished when the element is taken away part way through', async () => {
    const s = await pane();
    s.row.classList.add('out');
    await settle();
    const [animation] = s.row.getAnimations();
    const finished = watch(animation.finished);
    s.row.remove();
    await settle();
    assert.equal(finished.state, 'rejected: AbortError');
  });

  it('rejects finished when the app goes', async () => {
    const s = await pane();
    s.row.classList.add('out');
    await settle();
    const [animation] = s.row.getAnimations();
    const finished = watch(animation.finished);
    s.app.unmount();
    await settle();
    assert.equal(finished.state, 'rejected: AbortError');
  });

  it('settles finished at once for finish() and cancel(), and refuses to finish an endless one', async () => {
    const s = await pane();
    s.row.classList.add('out');
    s.pane.classList.add('spins');
    await settle();
    const [exit] = s.row.getAnimations();
    const finished = watch(exit.finished);
    exit.finish();
    await settle();
    assert.equal(finished.state, 'fulfilled');
    assert.equal(exit.playState, 'finished');

    const [spin] = s.pane.getAnimations();
    assert.equal(spin.effect.getComputedTiming().iterations, Infinity);
    assert.equal(spin.effect.getComputedTiming().endTime, Infinity);
    assert.throws(() => spin.finish(), { name: 'InvalidStateError' });
    const cancelled = watch(spin.finished);
    spin.cancel();
    await settle();
    assert.equal(cancelled.state, 'rejected: AbortError');
    assert.equal(spin.playState, 'idle');
  });

  it('finds the animations of what an element holds, where asked', async () => {
    const s = await pane();
    s.row.classList.add('out');
    await settle();
    assert.equal(s.pane.getAnimations().length, 0, 'none of its own');
    const [exit] = s.pane.getAnimations({ subtree: true });
    assert.equal(exit.animationName, 'exit');
    assert.equal(exit.effect.target, s.row);
  });

  it('answers for a running transition, and settles when it ends', async () => {
    const s = await pane();
    s.pane.classList.add('fades');
    await settle();
    s.pane.classList.add('gone');
    await settle();
    const [transition] = s.pane.getAnimations();
    assert.equal(transition.transitionProperty, 'opacity');
    const finished = watch(transition.finished);
    await s.tick(50);
    assert.equal(transition.effect.getComputedTiming().progress, 0.5);
    assert.equal(transition.effect.getComputedTiming().endTime, 100);
    assert.equal(finished.state, 'pending');
    await s.tick(60);
    assert.equal(finished.state, 'fulfilled');
    assert.equal(transition.playState, 'finished');
  });

  it('rejects the finished of a transition another takes the place of', async () => {
    const s = await pane();
    s.pane.classList.add('fades');
    await settle();
    s.pane.classList.add('gone');
    await settle();
    const [transition] = s.pane.getAnimations();
    const finished = watch(transition.finished);
    await s.tick(50);
    s.pane.classList.remove('gone');
    await settle();
    assert.equal(finished.state, 'rejected: AbortError');
    assert.equal(transition.playState, 'idle');
    const [back] = s.pane.getAnimations();
    assert.notEqual(back, transition, 'the way back is another animation');
  });
});
