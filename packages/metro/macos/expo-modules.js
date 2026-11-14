/**
 * What Expo's own JavaScript libraries import from `expo` in a `macos` bundle, where no Expo native
 * module is. `@expo/ui`'s modifiers call `requireNativeModule('ExpoUI')` as they load; an app reads
 * those plain-JavaScript parts to style the desktop host's own `@expo/ui` views, so the library
 * must load. Each function here is inert until something uses what it returned, and then fails
 * naming the module, as a missing native module does where Expo runs.
 */
'use strict';

function missing(what) {
  return new Error(`${what} is not in a desktop app: no Expo native module is.`);
}

/** A module whose every member fails when used, and that has no `then` or interop markers. */
function requireNativeModule(name) {
  return new Proxy(
    {},
    {
      get(_, member) {
        if (typeof member === 'symbol' || member === 'then' || member === '__esModule')
          return undefined;
        return () => {
          throw missing(`The native module ${name} (${String(member)})`);
        };
      },
    },
  );
}

function requireOptionalNativeModule() {
  return null;
}

/** A view component that fails only when it is drawn. */
function requireNativeView(name) {
  return function NativeView() {
    throw missing(`The native view ${name}`);
  };
}

function useReleasingSharedObject() {
  throw missing('A native shared object');
}

function useReleasingSharedObjectWithLifecycle() {
  throw missing('A native shared object');
}

/** Nothing to install: there is no Expo on the UI runtime either. */
function installOnUIRuntime() {}

module.exports = {
  requireNativeModule,
  requireOptionalNativeModule,
  requireNativeView,
  useReleasingSharedObject,
  useReleasingSharedObjectWithLifecycle,
  installOnUIRuntime,
};
