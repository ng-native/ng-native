/**
 * The course's unit tests: the in-browser compile pipeline, the lesson model and the checks, run
 * in Node against the fake Fabric. `ngNative()` compiles `@ng-native/components` ahead of time as
 * an app's own tests would; the learner's code in these tests is compiled the way the preview
 * compiles it, by `src/learn/preview/program.ts` and Angular's JIT compiler.
 *
 * Sucrase is inlined because its parser is imported from its ES module build, whose relative
 * imports have no file extensions and so only resolve through Vite.
 */
import { ngNative } from '@ng-native/testing/vitest';
import { defineConfig } from 'vitest/config';
import { markdown } from './build/markdown.ts';

export default defineConfig({
  // `markdown()` because the lesson tests load each lesson as the site does, `lesson.md` and all.
  plugins: [markdown(), ngNative({ inline: ['sucrase'] })],
  // `css: true` so that a stylesheet imported with `?raw` is its text, not an empty string.
  // `build/**` alongside `src/**` so a Vite plugin under `build/` (`markdown.ts`'s own test, for
  // one) is covered by the same `vitest run` the rest of the site's unit tests are.
  test: {
    maxWorkers: 1,
    testTimeout: 30_000,
    include: ['src/**/*.test.ts', 'build/**/*.test.ts'],
    css: true,
  },
});
