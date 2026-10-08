/**
 * The known `@oxc-angular/vite` compiler bug `packages/metro/angular-transform.cjs` guards
 * against, guarded here too.
 *
 * The docs site compiles its own Angular straight out of `@ng-native/components`' source with
 * `@oxc-angular/vite`'s own Vite plugin rather than through the Metro pipeline, so it is exposed
 * to the same bug: a template arrow function that reads its own parameter compiles to read the
 * component instead (`(o) => !o` becomes `(o) => !ctx.o`). It fails silently - no compiler error,
 * a build that "succeeds" and then reads `undefined` wherever the bad output runs - which is what
 * `assertNoShadowedArrowParameters` exists to turn into a clear, immediate build failure.
 *
 * Reused rather than copied: the function is exported from `@ng-native/metro`, so another
 * confirmed compiler bug is one fix rather than two.
 *
 * A plugin of its own, placed after `angular()` in `vite.config.ts`'s `plugins` array. Vite runs a
 * `transform` hook in plugin order within one enforce tier, and neither plugin sets `enforce`, so
 * both sit in the default tier and this one sees `angular()`'s compiled output rather than the
 * source it started from.
 */
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
const { assertNoShadowedArrowParameters } = require('@ng-native/metro') as {
  assertNoShadowedArrowParameters: (code: string, filename: string) => void;
};

/** Angular's own compiled-component marker: what tells a compiled component apart from any other
 *  `.ts` module `transform` sees (this app's own source, a dependency, a virtual module). */
const IS_COMPILED_COMPONENT = /ɵɵdefineComponent/;

export function angularGuards(): Plugin {
  return {
    name: 'angular-native-docs-angular-guards',
    transform(code, id) {
      const filename = id.split('?')[0] ?? id;
      if (!/\.tsx?$/.test(filename) || !IS_COMPILED_COMPONENT.test(code)) return;
      assertNoShadowedArrowParameters(code, filename);
    },
  };
}
