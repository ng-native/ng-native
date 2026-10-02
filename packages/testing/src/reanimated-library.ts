/**
 * What a test gets for `react-native-reanimated`, whose source Node cannot load: the stand-in a
 * browser build gets too, with a shared value that is a signal, which a `[workletStyle]` in a test
 * follows (see `reanimated.ts`).
 */
export * from '@ng-native/components/stand-ins/reanimated';
export { sharedValue as makeMutable } from './reanimated.ts';
export type { SharedValue } from './reanimated.ts';
