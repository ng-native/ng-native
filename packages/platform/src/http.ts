/**
 * `HttpClient`, configured for React Native.
 *
 * ```ts
 * mount(rootTag, App, getFabricUIManager(), {
 *   providers: [provideNativeHttpClient(withInterceptors([auth]))],
 * });
 * ```
 *
 * Use this instead of `provideHttpClient()`, which can fail silently. Angular's default backend
 * is `fetch`, and it reads a response body only through `response.body`'s stream. Expo's `fetch`
 * streams one, but Metro runs Expo's runtime only when the bundle imports `expo`: a debug build
 * does through `mount()`'s reload hook, and a release build only if the app's `main.ts` does.
 * Without it the global `fetch` is React Native's, `whatwg-fetch` over XHR, whose `Response` has
 * no `body`, so every request resolves with `null` and nothing reports why. RN's `XMLHttpRequest`
 * is native and complete, upload progress included, and the same in every build, so the XHR
 * backend is the one to use.
 *
 * A separate entry point so an app that never makes a request does not need `@angular/common`.
 */
import type { EnvironmentProviders } from '@angular/core';
import {
  provideHttpClient,
  withXhr,
  type HttpFeature,
  type HttpFeatureKind,
} from '@angular/common/http';

export function provideNativeHttpClient(
  ...features: HttpFeature<HttpFeatureKind>[]
): EnvironmentProviders {
  return provideHttpClient(withXhr(), ...features);
}
