/**
 * A directive's input bound on an element whose template never imported the directive.
 *
 * `<text-input [formField]="f.name" />` without `FormField` in `imports` compiles, renders, and
 * binds nothing: the form stays empty and invalid, and nothing says why. Angular's own check
 * cannot help. Its template type-checker is not in this build, it assumes a hyphenated element is
 * a web component that may have any property, and its runtime check stands down without a DOM.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { mount } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function capture(run: () => Promise<void>): Promise<string[]> {
  const reports: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => reports.push(args.map(String).join(' '));
  try {
    await run();
  } finally {
    console.error = original;
  }
  return reports;
}

describe('a forms directive input with no directive to take it', () => {
  let mod: Record<string, unknown>;

  before(async () => {
    mod = await compileFixture('fixtures/signal-form.ts');
  });

  const run = (name: string, dev: boolean) =>
    capture(async () => {
      mount(1, mod[name] as Type<unknown>, createFakeFabric(), { dev });
      await settle();
    });

  it('names the directive to import, once per element name', async () => {
    const reports = await run('ForgottenFormField', true);
    assert.equal(reports.length, 2, reports.join('\n'));
    assert.match(reports[0]!, /'formField'.*<text-input>/);
    assert.match(reports[0]!, /FormField.*@angular\/forms\/signals/);
    assert.match(reports[1]!, /'formField'.*<switch>/);
  });

  it('says nothing when the directive is imported', async () => {
    assert.deepEqual(await run('SignalForm', true), []);
  });

  it('says nothing in a release build', async () => {
    assert.deepEqual(await run('ForgottenFormField', false), []);
  });
});
