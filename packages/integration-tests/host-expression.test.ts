/**
 * A component's `host` the compiler cannot read. `@oxc-angular/vite` drops a spread, a method and
 * a `host` that is a constant or a call, with no error, so the listeners never fire and the
 * attributes never appear. The build fails on one instead, naming the component and the entry.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');

const component = (host: string, before = '') => `
import { Component } from '@angular/core';
${before}
@Component({ selector: 'app-card', template: '', host: ${host} })
export class Card {
  on() { return true; }
  go() {}
}
`;
const compile = (host: string, before = '') =>
  transformAngular(component(host, before), '/app/src/card.ts');

describe('a host the compiler cannot read', () => {
  it('fails the build on a spread, naming the component and the entry', () => {
    assert.throws(
      () =>
        compile("{ ...SHARED, '(press)': 'go()' }", "const SHARED = { '[attr.data-x]': 'on()' };"),
      (error: Error) =>
        /card\.ts: Card's host cannot be read at build time: "\.\.\.SHARED"/.test(error.message) &&
        /Write the bindings out in the literal/.test(error.message),
    );
  });

  it('fails on a host that is a constant or a call, which is read as nothing at all', () => {
    assert.throws(() => compile('HOST', "const HOST = { '(press)': 'go()' };"), /"HOST"/);
    assert.throws(
      () => compile('host()', "const host = () => ({ '(press)': 'go()' });"),
      /"host\(\)"/,
    );
  });

  it('names only the entries that were dropped', () => {
    assert.throws(
      () =>
        compile("{ '(press)': 'go()', ...A, role: 'button', ...B }", 'const A = {}; const B = {};'),
      (error: Error) => /: "\.\.\.A", "\.\.\.B"\. /.test(error.message),
    );
  });
});

describe('a host the compiler reads', () => {
  it('compiles: strings, a same-file constant, a computed string key, class and style', () => {
    const host =
      "{ class: 'card', style: 'flex: 1', role: 'button', '[class.on]': 'on()', " +
      "'(press)': PRESS, ['[attr.data-z]']: 'on()' }";
    assert.doesNotThrow(() => compile(host, "const PRESS = 'go()';"));
  });

  it('compiles a component with no host, and an empty one', () => {
    assert.doesNotThrow(() => compile('{}'));
    assert.doesNotThrow(() =>
      transformAngular(
        "import { Component } from '@angular/core';\n@Component({ selector: 'a-b', template: '' })\nexport class B {}\n",
        '/app/src/b.ts',
      ),
    );
  });
});
