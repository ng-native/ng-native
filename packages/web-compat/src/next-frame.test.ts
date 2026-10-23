/**
 * `oncePerFrame`: what an observer looks with, once a frame however often it is asked.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { oncePerFrame } from './next-frame.ts';

const globals = globalThis as { setTimeout: typeof setTimeout; requestAnimationFrame?: unknown };

it('runs once in the next frame, however often it is asked before then', async () => {
  let runs = 0;
  const { ask } = oncePerFrame(() => runs++);
  ask();
  ask();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(runs, 1);
  ask();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(runs, 2, 'and again in a later frame');
});

it('asks again at once once told to forget a request that will not be answered', async () => {
  // An app that went away took the timer its request was on: the next app's first one was passed
  // over for a second, and its observers saw nothing.
  let runs = 0;
  const { ask, forget } = oncePerFrame(() => runs++);
  const own = { setTimeout: globals.setTimeout, raf: globals.requestAnimationFrame };
  const lost = (() => 0) as unknown as typeof setTimeout;
  try {
    globals.setTimeout = lost;
    globals.requestAnimationFrame = lost;
    ask();
  } finally {
    globals.setTimeout = own.setTimeout;
    globals.requestAnimationFrame = own.raf;
  }
  forget();
  ask();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(runs, 1);
});
