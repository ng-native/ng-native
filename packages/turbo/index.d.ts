/**
 * The part of `turbo gen`'s Plop API the generators are registered with: `PlopTypes.NodePlopAPI`
 * from `@turbo/gen` has it, so the config `init` writes passes its `plop` as it is.
 */
export interface GeneratorRegistry {
  setGenerator(name: string, config: object): unknown;
}

/**
 * Registers Angular Native's generators with `turbo gen`: `ng-native-app`, `ng-native-library`,
 * `ng-native-component` and `ng-native-sync`. Call it from `turbo/generators/config.ts`.
 */
export declare function ngNative(plop: GeneratorRegistry): void;

export default ngNative;
