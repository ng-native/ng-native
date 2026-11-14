/**
 * Every lesson, checked the way the preview checks a learner: each step's checks pass against the
 * lesson's solution, and the first step's do not pass against its starter, so a lesson can be
 * neither impossible nor already done. Each step's snapshot, what its Solution button puts in
 * place, passes the checks up to that step and not the next step's, so it solves its own step and
 * gives away nothing after it.
 *
 * Run three times, by `lessons.test.ts`, `lessons.android.test.ts` and `lessons.macos.test.ts`,
 * because the preview runs the checks on whichever platform the phone is showing, and a check that
 * only passes on iOS would mark a finished step unfinished the moment the learner switched to
 * Android. The macOS run holds every lesson's app to running on a Mac too. Each is a file of
 * its own because `registerPlatformComponents` changes a table for the life of the module graph,
 * as it does in the preview, where switching platform reloads the frame.
 *
 * The native CSS compiler here is the Node build of the one the preview runs on WebAssembly, and
 * Tailwind goes through the same `flattenTailwind` step, so a check that reads a style reads what
 * a device build would commit. As in the preview, only a check marked `readsStyles` gets them.
 */
import '@angular/compiler';
import * as common from '@angular/common';
import * as core from '@angular/core';
import * as signalForms from '@angular/forms/signals';
import * as components from '@ng-native/components';
import * as device from '@ng-native/device';
import * as testing from '@ng-native/testing';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { LESSONS, loadLesson, type Lesson } from './course.ts';
import { lowerSource } from './preview/lower-source.ts';
import type { CompiledFile } from './preview/program.ts';
import { tailwindCss } from './preview/tailwind.ts';
import { runChecks, runTestFile, type RunnerOptions } from './preview/test-runner.ts';
import { vitest } from './preview/vitest-api.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss: (
    css: string,
    context: string,
    options?: { onUnsupported?: (message: string) => void },
  ) => object;
};
const { flattenTailwind } = require('@ng-native/tailwind/flatten.cjs') as {
  flattenTailwind: (css: string) => string;
};

async function options(files: Readonly<Record<string, string>>): Promise<RunnerOptions> {
  const libraries = {
    '@angular/core': core,
    '@angular/common': common,
    '@angular/forms/signals': signalForms,
    '@ng-native/components': components,
    '@ng-native/device': device,
    '@ng-native/testing': testing,
    vitest,
  };
  return {
    files,
    libraries,
    // As the preview does it: only for a check that says it reads styles, so one that forgets to
    // say so fails here too.
    nativeStyles: async () => {
      const tailwind = await tailwindCss(files);
      const globalStyles = tailwind.used
        ? compileCss(flattenTailwind(tailwind.css), 'Tailwind', { onUnsupported: () => {} })
        : undefined;
      const render: typeof testing.render = (component, renderOptions = {}) =>
        testing.render(component, { globalStyles: globalStyles as never, ...renderOptions });
      return {
        libraries: { '@ng-native/testing': { ...testing, render } },
        prepare: async (compiled: readonly CompiledFile[]) => {
          for (const { file, lowered, classes } of compiled) {
            for (const type of classes) {
              const styles = lowered.styles[type.name];
              if (styles) {
                (type as unknown as Record<string, unknown>)['ɵnativeStyles'] = compileCss(
                  styles.css,
                  `${file} (${type.name})`,
                  { onUnsupported: () => {} },
                );
              }
            }
          }
        },
      };
    },
  };
}

const failures = (outcomes: readonly { name: string; ok: boolean; error?: string }[]) =>
  outcomes.filter((outcome) => !outcome.ok).map(({ name, error }) => `${name}: ${error}`);

const written = LESSONS.filter((lesson) => !lesson.planned);

export function describeLessons(platform: 'ios' | 'android' | 'macos'): void {
  describe.each(written)(`lesson $number, $title, on ${platform}`, ({ slug }) => {
    let lesson: Lesson;
    let solution: Lesson['starter'];

    it('loads, with a step for every check and a snapshot for every step', async () => {
      lesson = (await loadLesson(slug))!;
      expect(lesson).toBeDefined();
      expect(lesson.steps.length).toBeGreaterThan(0);
      expect(lesson.snapshots).toHaveLength(lesson.steps.length);
      solution = lesson.snapshots.at(-1)!;
      expect(lesson.starter['app.ts']).toBeDefined();
      for (const snapshot of lesson.snapshots) expect(snapshot['app.ts']).toBeDefined();
      const outcomes = await runChecks(await options(solution), lesson.checks, 99);
      const steps = new Set(outcomes.map((outcome) => outcome.step));
      expect([...steps].sort()).toEqual(lesson.steps.map((_, index) => index + 1));
    });

    it('passes every check against its solution', async () => {
      const outcomes = await runChecks(await options(solution), lesson.checks, lesson.steps.length);
      expect(failures(outcomes)).toEqual([]);
    });

    it("passes each step's checks, and those before it, against the step's snapshot", async () => {
      for (const [index, snapshot] of lesson.snapshots.entries()) {
        const outcomes = await runChecks(await options(snapshot), lesson.checks, index + 1);
        expect({ step: index + 1, failures: failures(outcomes) }).toEqual({
          step: index + 1,
          failures: [],
        });
      }
    });

    it("does not pass the next step against a step's snapshot", async () => {
      for (const [index, snapshot] of lesson.snapshots.slice(0, -1).entries()) {
        const next = index + 2;
        const outcomes = await runChecks(await options(snapshot), lesson.checks, next);
        const nextOutcomes = outcomes.filter((outcome) => outcome.step === next);
        expect(nextOutcomes.length).toBeGreaterThan(0);
        expect({
          step: index + 1,
          solvesNext: nextOutcomes.every((outcome) => outcome.ok),
        }).toEqual({ step: index + 1, solvesNext: false });
      }
    });

    it('does not pass its first step against its starter', async () => {
      const outcomes = await runChecks(await options(lesson.starter), lesson.checks, 1);
      expect(outcomes.some((outcome) => !outcome.ok)).toBe(true);
    });

    it('starts with CSS a device build has nothing to say about', async () => {
      // The preview holds its native CSS notes back until a stylesheet or a class changes, so a
      // note the starter itself earned would never be shown.
      const said: string[] = [];
      for (const [file, source] of Object.entries(lesson.starter)) {
        for (const [name, { css }] of Object.entries(lowerSource(source).styles)) {
          compileCss(css, `${file} (${name})`, { onUnsupported: (message) => said.push(message) });
        }
      }
      const tailwind = await tailwindCss(lesson.starter);
      if (tailwind.used) {
        compileCss(flattenTailwind(tailwind.css), 'Tailwind', {
          onUnsupported: (message) => {
            if (!message.includes("dropped '--")) said.push(message);
          },
        });
      }
      expect(said).toEqual([]);
    });

    it("passes each snapshot's own tests", async () => {
      for (const snapshot of lesson.snapshots) {
        for (const file of Object.keys(snapshot).filter((name) => name.endsWith('.spec.ts'))) {
          expect(failures(await runTestFile(await options(snapshot), file))).toEqual([]);
        }
      }
    });
  });
}
