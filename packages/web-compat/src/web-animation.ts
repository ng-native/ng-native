import type { Engine, EngineNode, RunningAnimation, Transition } from '@ng-native/fabric';
import { watchCommits } from './commit-watch.ts';
import { topOf } from './document-roots.ts';
import { domError } from './dom-error.ts';
import { engineOf } from './window.ts';

/**
 * What the engine's own `getAnimations` gives for each animation running on a node: the shape
 * Angular's `animate.enter` and `animate.leave` read how long to wait from.
 */
export interface CoreAnimation {
  /** The name of the `@keyframes` it plays, where it is one and no transition. */
  readonly animationName?: string;
  readonly transitionProperty?: string;
  readonly effect: { getTiming(): { duration: number; delay: number; iterations: number } };
}

type PlayState = 'running' | 'paused' | 'finished' | 'idle';
type Fill = 'none' | 'forwards' | 'backwards' | 'both';

/** How an animation is timed, and how far along its clock it is: null where it is no longer. */
interface Clock {
  readonly delay: number;
  readonly duration: number;
  readonly iterations: number;
  readonly fill: Fill;
  readonly direction: string;
  readonly localTime: number | null;
}

const fillsForwards = (fill: Fill): boolean => fill === 'forwards' || fill === 'both';
const fillsBackwards = (fill: Fill): boolean => fill === 'backwards' || fill === 'both';

/** The animations of each app whose `finished` is still owed, to be cancelled when it goes. */
const owed = new Map<Engine, Set<WebAnimation>>();

/** Each engine record, by the animation a script holds of it: asked twice, it is the same one. */
/**
 * Which run of an animation a record is: given to a record the first time a script is given it,
 * and kept on the copies the engine makes of it as it plays on (it copies one with a spread,
 * which keeps this), but not on a new run, which a removed and added animation is, at any time.
 */
const RUN = Symbol('run');
type Run = RunningAnimation & { [RUN]?: object };

/** The run a record is, given one where it has none. */
const runOf = (record: Run): object => (record[RUN] ??= {});

/** The `@keyframes` animation a script was last given of each element. */
const playingOn = new WeakMap<EngineNode, WebAnimation>();
const animations = new WeakMap<RunningAnimation | Transition, WebAnimation>();

/**
 * A running animation as the Web Animations API has it, over the engine's record of an
 * `@keyframes` animation or a transition. A library reads how far it has got from
 * `effect.getComputedTiming()` and waits on `finished` before it takes a leaving element away:
 * it resolves when the engine ends the animation, and rejects with an `AbortError` when the
 * animation stops first, as the element no longer asks for it, it is taken away, or its app goes.
 * `effect.updateTiming({ fill: 'forwards' })` holds an `@keyframes` animation at its last frame
 * when it ends, which a closing dialog does to each exit.
 *
 * While `finished` is owed, the animation's end and cancel events are listened for, and each
 * commit of its app is looked at for it having stopped: see `commit-watch.ts`. Listening holds
 * an animation with no fill at its last frame until the listener has run, so a library that takes
 * the element away then never shows it back at rest.
 *
 * ponytail: `finish()` and `cancel()` settle `finished` and `playState` and leave the frames to
 * the engine: a library calls them as it takes the element away, or puts back the class that
 * ends the animation. `updateTiming` reads the fill alone, and a transition's not at all.
 */
export class WebAnimation {
  readonly animationName?: string;
  readonly transitionProperty?: string;
  readonly effect: AnimationEffect;
  private readonly node: EngineNode;
  /** The engine's record, as it was last found: it can be swapped for a copy as it plays. */
  private record: RunningAnimation | Transition;
  /**
   * Where a transition started and what it eased to: the engine turns the record of one that
   * changes course into the next, which is another animation, and this one cancelled.
   */
  private readonly run?: Pick<Transition, 'start' | 'to' | 'duration'>;
  /** Where `finish()` or `cancel()` left it, which stands over what the engine says. */
  private ended: 'finished' | 'idle' | undefined;
  private promise: Promise<WebAnimation> | undefined;
  private settle: ((state: 'finished' | 'idle') => void) | undefined;

  constructor(core: CoreAnimation, node: EngineNode, record: RunningAnimation | Transition) {
    if (core.animationName !== undefined) this.animationName = core.animationName;
    else this.transitionProperty = core.transitionProperty;
    this.node = node;
    this.record = record;
    if ('to' in record) {
      const { start, to, duration } = record;
      this.run = { start, to, duration };
    }
    this.effect = new AnimationEffect(this, core.effect, node);
  }

  /**
   * Whether it is what the engine's record runs now: a transition by where it started and what it
   * eases to, and an animation by its name and start, as the engine copies one it plays on.
   */
  isOf(record: RunningAnimation | Transition): boolean {
    const { run } = this;
    if (run) return 'to' in record && record.start === run.start && record.to === run.to;
    if (record === this.record || 'to' in record) return record === this.record;
    return runOf(record) === runOf(this.record as Run);
  }

  get playState(): PlayState {
    if (this.ended) return this.ended;
    const playing = this.playing();
    if (playing) return playing.pausedAt === undefined ? 'running' : 'paused';
    const transition = this.transition();
    if (transition) return 'running';
    return this.over();
  }

  get finished(): Promise<WebAnimation> {
    if (this.promise) return this.promise;
    let resolve!: (animation: WebAnimation) => void;
    let reject!: (error: Error) => void;
    this.promise = new Promise((done, fail) => ((resolve = done), (reject = fail)));
    // A browser marks it handled: a library that cancels need not catch what it cancelled.
    this.promise.catch(() => {});
    const engine = engineOf(this.node);
    const stops = this.listen(engine);
    this.settle = (state) => {
      this.settle = undefined;
      for (const stop of stops) stop();
      const pending = owed.get(engine);
      if (pending?.delete(this) && !pending.size) owed.delete(engine);
      if (state === 'finished') resolve(this);
      else reject(domError('The animation was cancelled.', 'AbortError'));
    };
    let pending = owed.get(engine);
    if (!pending) owed.set(engine, (pending = new Set()));
    pending.add(this);
    this.look();
    return this.promise;
  }

  finish(): void {
    if (this.effect.getComputedTiming().endTime === Infinity) {
      const message = 'Cannot finish an animation with an infinite end.';
      throw domError(message, 'InvalidStateError');
    }
    this.end('finished');
  }

  cancel(): void {
    this.end('idle');
  }

  /** What `getComputedTiming` is worked out from: see `Clock`. */
  clock(): Clock {
    const now = engineOf(this.node).now();
    const gone = this.playState === 'idle';
    if (this.run) {
      // A transition's start has its delay in it.
      const { start, duration } = this.run;
      const localTime = gone ? null : now - start;
      const timing = { delay: 0, duration, iterations: 1 };
      return { ...timing, fill: 'backwards', direction: 'normal', localTime };
    }
    const running = this.playing() ?? (this.record as RunningAnimation);
    const { spec } = running;
    const fill = running.held && !fillsForwards(spec.fill) ? held(spec.fill) : spec.fill;
    return {
      delay: spec.delay,
      duration: spec.duration,
      iterations: spec.iterations ?? Infinity,
      fill,
      direction: spec.direction ?? 'normal',
      localTime: gone ? null : (running.pausedAt ?? now) - running.start,
    };
  }

  /**
   * Hold an `@keyframes` animation at its last frame once it ends, or stop holding it: one that
   * has ended already goes back to rest.
   */
  hold(fill: string): void {
    this.playing();
    const record = this.record;
    if ('to' in record || this.node.playing !== record) return;
    if (fill === 'forwards' || fill === 'both') {
      if (!record.done) record.held = true;
      return;
    }
    record.held = undefined;
    if (record.done) engineOf(this.node).releaseFinished(this.node);
  }

  /** The `@keyframes` animation the node is playing, while it is this one and has not ended. */
  private playing(): RunningAnimation | undefined {
    if (this.animationName === undefined || !this.onScreen()) return undefined;
    const playing = this.node.playing;
    // The engine copies one it plays on along other frames: the same run, by its token.
    const copy = playing !== undefined && runOf(playing as Run) === runOf(this.record as Run);
    if (!playing || (playing !== this.record && !copy)) return undefined;
    this.record = playing;
    return playing.done ? undefined : playing;
  }

  /** The transition, while the node still runs it and it has not ended. */
  private transition(): Transition | undefined {
    if (this.transitionProperty === undefined || !this.onScreen()) return undefined;
    const transition = this.node.transitions?.get(this.transitionProperty);
    const running = transition === this.record && this.isOf(transition) && !transition.done;
    return running ? transition : undefined;
  }

  /** Where it is once it is no longer running: at its end, or stopped before it. */
  private over(): 'finished' | 'idle' {
    if (this.record.done && this.isOf(this.record)) return 'finished';
    if (this.transitionProperty !== undefined || !this.onScreen()) return 'idle';
    // The node plays another by now, or none. Not looked at since it was copied as it played,
    // it ended first where the clock is past its end.
    const { spec, start } = this.record as RunningAnimation;
    const end = start + spec.delay + spec.duration * (spec.iterations ?? Infinity);
    return engineOf(this.node).now() >= end ? 'finished' : 'idle';
  }

  /** Whether the node is still in the tree its app shows. */
  private onScreen(): boolean {
    return topOf(this.node) === engineOf(this.node).root;
  }

  /** Settle `finished` where it is owed and the animation is no longer running. */
  private look(): void {
    const state = this.playState;
    if (state === 'finished' || state === 'idle') this.settle?.(state);
  }

  private end(state: 'finished' | 'idle'): void {
    this.ended = state;
    this.settle?.(state);
  }

  /** What tells it the animation may have stopped, while `finished` is owed. */
  private listen(engine: Engine): (() => void)[] {
    const named = (event: unknown) => (event as { animationName?: string }).animationName;
    const stops = [watchCommits(engine, () => this.look())];
    if (this.animationName === undefined) {
      stops.push(engine.setEventListener(this.node, 'topTransitionend', () => this.look()));
      return stops;
    }
    const hear = (type: string, state: 'finished' | 'idle') =>
      engine.setEventListener(this.node, type, (event) => {
        if (named(event) === this.animationName) this.settle?.(state);
      });
    stops.push(hear('topAnimationend', 'finished'), hear('topAnimationcancel', 'idle'));
    return stops;
  }
}

/** The fill an animation has once script holds it at its last frame. */
const held = (fill: Fill): Fill => (fill === 'backwards' ? 'both' : 'forwards');

/** The effect of an animation: its timing as written, and as it works out now. */
class AnimationEffect {
  readonly target: EngineNode;
  private readonly animation: WebAnimation;
  private readonly core: CoreAnimation['effect'];

  constructor(animation: WebAnimation, core: CoreAnimation['effect'], target: EngineNode) {
    this.animation = animation;
    this.core = core;
    this.target = target;
  }

  /** The engine's own, which Angular reads: its duration is the whole run, every iteration. */
  getTiming(): ReturnType<CoreAnimation['effect']['getTiming']> {
    return this.core.getTiming();
  }

  /** Where it has got to, as the Web Animations API works it out: its duration is one iteration. */
  getComputedTiming() {
    const { delay, duration, iterations, fill, direction, localTime } = this.animation.clock();
    const activeDuration = duration === 0 ? 0 : duration * iterations;
    const endTime = delay + activeDuration;
    const timing = { delay, endDelay: 0, duration, iterations, iterationStart: 0, fill, direction };
    const at = progress(localTime, delay, duration, iterations, fill, endTime);
    return { ...timing, activeDuration, endTime, localTime, ...at };
  }

  updateTiming(timing?: { fill?: string }): void {
    if (timing?.fill !== undefined) this.animation.hold(timing.fill);
  }
}

/**
 * How far through its iteration an animation is, and which iteration: null for each before it
 * starts or after it ends, where no fill shows it.
 */
function progress(
  localTime: number | null,
  delay: number,
  duration: number,
  iterations: number,
  fill: Fill,
  endTime: number,
): { progress: number | null; currentIteration: number | null } {
  const none = { progress: null, currentIteration: null };
  if (localTime === null) return none;
  if (localTime < delay) return fillsBackwards(fill) ? { progress: 0, currentIteration: 0 } : none;
  if (localTime >= endTime) {
    if (!fillsForwards(fill)) return none;
    const part = iterations % 1;
    if (part !== 0) return { progress: part, currentIteration: Math.floor(iterations) };
    return { progress: 1, currentIteration: Math.max(0, iterations - 1) };
  }
  const through = (localTime - delay) / duration;
  const currentIteration = Math.floor(through);
  return { progress: through - currentIteration, currentIteration };
}

/** The animation a script holds of what the engine runs on `node`: the same one each time. */
export function webAnimation(core: CoreAnimation, node: EngineNode): WebAnimation | undefined {
  const record =
    core.animationName !== undefined
      ? node.playing
      : node.transitions?.get(core.transitionProperty ?? '');
  if (!record) return undefined;
  // An animation is kept by its element, which the engine gives a copy of its record as it plays.
  const kept = core.animationName !== undefined ? playingOn.get(node) : animations.get(record);
  if (kept?.isOf(record)) return kept;
  const animation = new WebAnimation(core, node, record);
  if (core.animationName !== undefined) {
    // Given now, so the copies the engine makes from here on are known as this run.
    runOf(record as Run);
    playingOn.set(node, animation);
  } else animations.set(record, animation);
  return animation;
}

/**
 * The `@keyframes` animation an element still shows at its last frame once it has finished, by
 * its own fill or one a script asked for: still one of the element's animations, as a browser has
 * an animation that is in effect. The engine leaves it out of what it answers, which Angular reads
 * to know how long to wait for an animation that is still to end.
 */
export function heldAnimation(node: EngineNode): WebAnimation | undefined {
  const playing = node.playing;
  if (!playing?.done || !(playing.held || fillsForwards(playing.spec.fill as Fill))) {
    return undefined;
  }
  const { name, duration, delay, iterations } = playing.spec;
  const timing = {
    duration: duration * (iterations ?? Infinity),
    delay,
    iterations: iterations ?? Infinity,
  };
  return webAnimation({ animationName: name, effect: { getTiming: () => timing } }, node);
}

/** An app has gone: each `finished` it still owed rejects, as its elements went with it. */
export function cancelAnimations(engine: Engine): void {
  for (const animation of [...(owed.get(engine) ?? [])]) animation.cancel();
  owed.delete(engine);
}
