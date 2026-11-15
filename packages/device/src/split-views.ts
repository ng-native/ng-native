import { reactNative } from './react-native.ts';

interface SplitViewsModule {
  getConstants?(): { available?: boolean };
}

/** The module's answer, asked once of each module: it is fixed for the app's life. */
const answers = new WeakMap<object, boolean>();

/**
 * Whether the iOS host draws `<split-view>` itself, as a UISplitViewController: on an iPad, with
 * `@ng-native/components`' pod, whose `NgNativeSplitViews` module says so with its constant
 * `available`. False on an iPhone, in Expo Go, and wherever React Native is not. Asked as an
 * element is named, so the module is looked up each time and its constant read once.
 */
export function nativeSplitViews(): boolean {
  const module = reactNative()?.TurboModuleRegistry?.get?.('NgNativeSplitViews') as
    SplitViewsModule | null | undefined;
  if (!module) return false;
  let answer = answers.get(module);
  if (answer === undefined) {
    answer = module.getConstants?.().available === true;
    answers.set(module, answer);
  }
  return answer;
}
