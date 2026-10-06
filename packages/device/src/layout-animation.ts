/**
 * Animating a layout *change*, which CSS cannot express.
 *
 * A transition animates a property from one value to another, and the engine already does that. It
 * cannot animate a layout: when a row is removed and the rows below move up, nothing about those
 * rows changed - their `top` was never set, Yoga computed it, and there is no old value to
 * transition from. The web solves this with FLIP, measuring before and after in JavaScript; native
 * solves it in the shadow tree, which is where the two layouts both exist.
 *
 * So this is not a nicer `LayoutAnimation` - it is the only way to say the thing at all. What it
 * adds is the promise, and the scope: `configureNext` applies to the next commit *whenever that
 * happens* and whatever makes it, a frame of a CSS animation or an unrelated screen appearing as
 * much as the change meant. Here the animation is configured as the change's own commit is handed
 * over, and not at all when the change commits nothing.
 */

import { ApplicationRef, InjectionToken, Service, inject } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { reactNative } from './react-native.ts';

/**
 * How a change is eased. `spring` is the platform's own, and is what a native list uses.
 * `keyboard` is the curve iOS moves its keyboard on, which a keyboard event reports by that name.
 */
export type LayoutEasing =
  'spring' | 'linear' | 'easeInEaseOut' | 'easeIn' | 'easeOut' | 'keyboard';

export interface LayoutChange {
  readonly duration?: number;
  readonly easing?: LayoutEasing;
  /** What a view appearing does. `opacity` fades it in; the default is to scale it up. */
  readonly appear?: 'opacity' | 'scaleXY' | 'none';
  /** What a view leaving does. */
  readonly leave?: 'opacity' | 'scaleXY' | 'none';
}

export interface NativeLayoutAnimation {
  configureNext(config: object, onDone?: () => void): void;
}

const DEFAULTS = { duration: 300, easing: 'easeInEaseOut' as LayoutEasing };

/**
 * How long past its duration an animation is given before `animate` resolves without its
 * completion: a few frames of slack, so that the completion is the one that resolves it wherever
 * one comes. React Native calls it at the end of the animation, or from a timer of its own a frame
 * after the duration where native reports nothing, as on Android with layout animations off. It
 * calls nothing at all where animations are disabled.
 */
const COMPLETION_GRACE_MS = 50;

/** Angular's NG0101, `ApplicationRef.tick()` called while it is running. */
const RECURSIVE_TICK = 101;

/**
 * `inject(LayoutAnimation).animate(() => this.rows.update(...))`.
 *
 * The only way to say "animate the layout this change produces": a transition needs a value to
 * animate from, and a row that moves up because the one above it left never had one.
 */
@Service()
export class LayoutAnimation {
  /** Overridden in a test to watch a configuration without one being applied. */
  static readonly SOURCE = new InjectionToken<NativeLayoutAnimation | null>(
    'angular-native.layoutAnimationSource',
    { factory: () => reactNative()?.LayoutAnimation ?? null },
  );

  private readonly native = inject(LayoutAnimation.SOURCE);
  private readonly engine = inject(Engine, { optional: true });
  private readonly application = inject(ApplicationRef, { optional: true });

  /**
   * Run `change` and animate the layout its commit produces.
   *
   * The change is taken rather than left to the caller because the platform animates whatever
   * commit comes next, and only this can make that the change's own: change detection runs and
   * the change commits before `animate` returns, with the animation configured as that commit is
   * handed over. A frame of another animation cannot land in between and take it, and a change
   * that commits nothing configures nothing, so no later commit is animated in its place. Resolves
   * when the animation ends, once its duration has passed where the platform does not report
   * that, or at once when there was nothing to animate.
   */
  async animate(change: () => void, options: LayoutChange = {}): Promise<void> {
    const native = this.native;
    if (!native) {
      change();
      return;
    }

    let configured = false;
    let finish!: () => void;
    const done = new Promise<void>((resolve) => (finish = resolve));
    const configure = (): void => {
      configured = true;
      native.configureNext(config(options), finish);
      // React Native calls no completion where animations are disabled, so nothing should wait
      // on it forever.
      setTimeout(finish, (options.duration ?? DEFAULTS.duration) + COMPLETION_GRACE_MS);
    };

    // With no engine there is no commit to wait for: a service built on its own, as in a test.
    if (!this.engine) {
      configure();
      change();
      return done;
    }

    const withdraw = this.engine.beforeNextCommit(configure);
    try {
      change();
      this.detectChanges();
    } catch (error) {
      // Nothing was changed, so nothing is to be animated, not even a commit made in this turn.
      withdraw();
      throw error;
    } finally {
      // Called from inside a pass, the commit is that pass's own, which ends before any microtask.
      queueMicrotask(() => {
        withdraw();
        if (!configured) finish();
      });
    }
    return done;
  }

  /** Run change detection now, unless a pass is already running and will reach the change. */
  private detectChanges(): void {
    try {
      this.application?.tick();
    } catch (error) {
      if ((error as { code?: number }).code !== RECURSIVE_TICK) throw error;
    }
  }
}

/**
 * The config React Native takes, from the three things worth naming.
 *
 * `create` and `delete` need a `property` as well as a type, because a view appearing has no
 * previous size to animate from - it has to be told what to animate *of*. Leaving that out is the
 * most common way one of these does nothing.
 */
function config(options: LayoutChange): object {
  const duration = options.duration ?? DEFAULTS.duration;
  const easing = options.easing ?? DEFAULTS.easing;
  const appear = options.appear ?? 'opacity';
  const leave = options.leave ?? 'opacity';

  return {
    duration,
    update: { type: easing, ...(easing === 'spring' ? { springDamping: 0.7 } : {}) },
    ...(appear === 'none' ? {} : { create: { type: easing, property: appear } }),
    ...(leave === 'none' ? {} : { delete: { type: easing, property: leave } }),
  };
}
