/**
 * A template arrow function, compiled by the Metro transform and rendered. `@oxc-angular/vite`
 * through 0.0.40 compiled `(n) => n * 2` as `(n) => ctx.n * 2`; 0.0.41 hoists it through
 * `ɵɵarrowFunction`, which `@angular/core` has to provide.
 */
import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

it("reads a template arrow function's own parameter", async () => {
  const mod = await compileFixture('fixtures/template-arrows.ts');
  const { getByText } = await render(mod['Arrows'] as Type<unknown>);
  assert.ok(getByText('2,4'));
});
