/**
 * What Expo installs on the global when the app starts. Only the app identifier matters here;
 * `getViewConfig` is for React's renderer, which never runs.
 */
interface ExpoGlobal {
  readonly __expo_app_identifier__?: string;
}

/**
 * The Fabric component name for an Expo module's view, exactly as `requireNativeViewManager`
 * computes it in `expo-modules-core`.
 *
 * The app identifier is the part that cannot be hardcoded. Expo Go runs many projects in one
 * binary, so it namespaces every view name with a per-app suffix; a standalone build has no
 * identifier and no suffix. Get it wrong and the view commits as `UnimplementedNativeView`
 * with no error, which is the same failure mode as a misspelled name.
 *
 * A module with more than one view names the extra ones (`viewName`); the default view is the
 * module itself.
 *
 * Internal: it lives here because `@ng-native/expo` and `@ng-native/router` both derive these
 * names and cannot import each other. Apps use `expoViewName` from `@ng-native/expo`.
 */
export function expoViewName(moduleName: string, viewName?: string): string {
  const identifier = (globalThis as { expo?: ExpoGlobal }).expo?.__expo_app_identifier__ ?? '';
  const suffix = identifier ? `_${identifier}` : '';
  const module = viewName ? `${moduleName}_${viewName}` : moduleName;
  return `ViewManagerAdapter_${module}${suffix}`;
}
