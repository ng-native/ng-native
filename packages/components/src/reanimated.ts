/**
 * Reanimated, without React: a style computed on the UI thread, bound to one of our nodes.
 *
 * ```ts
 * import { WorkletStyle, sharedValue, workletStyle } from '@ng-native/components/reanimated';
 *
 * protected readonly offset = sharedValue(0);
 * protected readonly slide = workletStyle([this.offset], (offset) => {
 *   'worklet';
 *   return { transform: [{ translateX: offset.value }] };
 * });
 * ```
 * ```html
 * <view [workletStyle]="slide">
 * ```
 *
 * Deliberately outside the barrel: everything here reaches React Native's
 * Flow source, which Node cannot parse, and the rest of the package has to stay loadable in the
 * test suite.
 *
 * What makes this work at all is that Reanimated addresses a view by its **shadow node**, not by a
 * React instance. `getShadowNodeWrapperFromRef` digs one out of a fiber; our engine has held the
 * same object since it created the node, so there is nothing to dig for. `startMapper` and
 * `makeMutable` are public, and the whole React half of `useAnimatedStyle` - refs, effects, the
 * animated component wrapper - is what an Angular directive replaces.
 *
 * An app installs `react-native-reanimated` and `react-native-worklets` itself, and gets the
 * worklet Babel plugin from `babel-preset-expo`, which adds it as soon as the package is present.
 * Everything else an animation needs - `withTiming`, `withSpring`, `interpolate`, `Easing` - is
 * imported from `react-native-reanimated` directly: they are plain functions with no React in
 * them, and re-exporting them here would only add a name to keep in step.
 */
import { Directive } from '@angular/core';
import { makeMutable, startMapper, stopMapper } from 'react-native-reanimated';
/**
 * `updateProps` is what every animated style in Reanimated goes through, and there is no exported
 * equivalent. It is a worklet, so it is called from ours rather than from here.
 *
 * Two things about the import. It goes through `src/` because that is where the package's own
 * `react-native` field points and Metro prefers that field: the built `lib/` copy would be a
 * second Reanimated in the bundle, with module state of its own. And it is a `require`, so that
 * these sources stay out of our type-checking program, where they fail against settings they were
 * never written for.
 */
const { updateProps } = require('react-native-reanimated/src/updateProps/index.ts') as {
  updateProps(descriptors: object, updates: Record<string, unknown>): void;
};
import { WorkletScrollBase } from './worklet-scroll.ts';
import { WorkletStyleBase } from './worklet-style.ts';
import { WORKLETS, type MutableValue, type WorkletBackend } from './worklets.ts';

export {
  workletScroll,
  workletStyle,
  type SharedValue,
  type WorkletScrollSpec,
  type WorkletStyleSpec,
} from './worklets.ts';

/**
 * A value both runtimes can see. Reanimated's own `useSharedValue` is this plus a React ref, and
 * the ref is the half that does not apply here. Typed with the shape of Reanimated's own, so it
 * goes to `cancelAnimation` and the rest of the library as one of theirs would.
 */
export function sharedValue<T>(initial: T): MutableValue<T> {
  return makeMutable(initial);
}

const backend: WorkletBackend = {
  bind: (target, style) => {
    // The shape `updateProps` takes: a `{ value }` holder of descriptors, so that the set of
    // views a style drives can change without the worklet being rebuilt. Ours never does - one
    // directive drives one node - so a plain object is enough.
    const descriptors = { value: [{ tag: target.tag, shadowNodeWrapper: target.shadowNode }] };
    const { values, updater } = style;
    const id = startMapper(() => {
      'worklet';
      updateProps(descriptors, updater(...values));
    }, values as unknown[]);
    return () => stopMapper(id);
  },

  scroll: (target, spec) => {
    const { values, handler } = spec;
    // The same registration a gesture uses, on the name React Native's scroll views emit. The
    // event still reaches our own listeners: Reanimated observes it rather than consuming it.
    const id = registerEventHandler(
      (event: never) => {
        'worklet';
        handler(event, ...values);
      },
      'onScroll',
      target.tag,
    );
    return () => unregisterEventHandler(id);
  },
};

/**
 * Not public, and the same call Reanimated's own `WorkletEventHandler` makes. Reached through
 * `src/` for the reason `updateProps` is, and required rather than imported so that those sources
 * stay out of our type-checking program.
 */
const { registerEventHandler, unregisterEventHandler } =
  require('react-native-reanimated/src/core.ts') as {
    registerEventHandler(
      worklet: (event: never) => void,
      eventName: string,
      emitterReactTag: number,
    ): number;
    unregisterEventHandler(id: number): void;
  };

@Directive({
  selector: '[workletStyle]',
  providers: [{ provide: WORKLETS, useValue: backend }],
})
export class WorkletStyle extends WorkletStyleBase {}

@Directive({
  selector: '[workletScroll]',
  providers: [{ provide: WORKLETS, useValue: backend }],
})
export class WorkletScroll extends WorkletScrollBase {}
