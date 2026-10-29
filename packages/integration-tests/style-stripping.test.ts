/**
 * The shimmed CSS Angular emits into `styles: [...]` is dead weight here.
 *
 * Nothing reads it: the styles host that would consume it lives in `platform-browser`, which this
 * project does not use, and the real styling comes from the compiled sheet on `ɵnativeStyles`. It
 * was 8.6% of the canary's emitted component code.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');

const component = (styles: string, extra = '') =>
  [
    "import { Component } from '@angular/core';",
    `${extra}@Component({ selector: 'x-a', template: '<view></view>', styles: [\`${styles}\`] })`,
    'export class A {}',
  ].join('\n');

/** What the compiled component definition still carries: the call, and what follows it. */
const definition = (code: string) => code.slice(code.indexOf('ɵɵdefineComponent('));

describe('stripping the emitted CSS', () => {
  it('drops it from a release build, keeping the compiled sheet', () => {
    const { code } = transformAngular(component('.a { color: red }'), '/tmp/a.ts', { dev: false });
    assert.doesNotMatch(definition(code), /color: red/);
    assert.match(definition(code), /styles:\[\]/, 'the property is emptied, not removed');
    assert.match(code, /ɵnativeStyles/, 'the sheet that is actually used still ships');
    assert.match(code, /rgb\(255, 0, 0\)/);
  });

  it('leaves a dev build alone, so the HMR path sees what it expects', () => {
    const { code } = transformAngular(component('.a { color: red }'), '/tmp/a.ts', { dev: true });
    assert.match(definition(code), /color: red/);
  });

  it('handles CSS containing brackets, quotes and backticks', () => {
    const css = '.a[data-k="]"] { color: red } .b::after { color: blue }'.replace(
      '::after',
      ':not(.c)',
    );
    const { code } = transformAngular(component(css), '/tmp/b.ts', { dev: false });
    assert.doesNotMatch(definition(code), /data-k/);
    assert.match(definition(code), /styles:\[\]/);
  });

  it("does not touch an unrelated object of the user's that happens to have styles", () => {
    const source = [
      "import { Component } from '@angular/core';",
      "export const theme = { styles: ['keep me'] };",
      "@Component({ selector: 'x-c', template: '<view></view>', styles: ['.a { color: red }'] })",
      'export class C {}',
    ].join('\n');
    const { code } = transformAngular(source, '/tmp/c.ts', { dev: false });
    assert.match(code, /keep me/, "the user's own object is untouched");
    assert.doesNotMatch(definition(code), /color: red/);
  });

  it('adds nothing to a component that has no styles', () => {
    const source = [
      "import { Component } from '@angular/core';",
      "@Component({ selector: 'x-d', template: '<view></view>' })",
      'export class D {}',
    ].join('\n');
    const { code } = transformAngular(source, '/tmp/d.ts', { dev: false });
    assert.doesNotMatch(code, /styles:/, 'no empty array is invented where there was no key');
    assert.match(code, /ɵɵelement\(0,"view"\)/, 'the component still compiles');
  });

  it('drops the class metadata that carries a second, unshimmed copy of the CSS', () => {
    // `ɵsetClassMetadata` re-emits the decorator arguments verbatim, so the CSS shipped twice:
    // once shimmed in the definition and once raw here. It exists for TestBed's recompilation
    // APIs, which need a JIT compiler this project does not ship.
    const source = component('.a { color: red }');
    assert.match(transformAngular(source, '/tmp/e.ts', { dev: true }).code, /ɵsetClassMetadata/);
    assert.doesNotMatch(
      transformAngular(source, '/tmp/e.ts', { dev: false }).code,
      /ɵsetClassMetadata/,
    );
  });
});
