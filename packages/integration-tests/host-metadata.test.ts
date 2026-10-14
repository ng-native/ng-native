/**
 * A component's `host`, which `@oxc-angular/vite` evaluates at build time as Angular's compiler
 * does. Through 0.0.40 it dropped a spread, a constant or a call with no error, so the listeners
 * never fired; these pin that it reads them, and that a `host` it cannot read fails the build.
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
  transformAngular(component(host, before), '/app/src/card.ts').code as string;
const listens = (code: string) => /ɵɵlistener\("press"/.test(code);

describe("a component's host", () => {
  it('reads a spread, a constant and a call from the same file', () => {
    assert.ok(listens(compile('{ ...SHARED }', "const SHARED = { '(press)': 'go()' };")));
    assert.ok(listens(compile('HOST', "const HOST = { '(press)': 'go()' };")));
    assert.ok(listens(compile('host()', "function host() { return { '(press)': 'go()' }; }")));
  });

  it('fails the build on a host imported from another file, naming it', () => {
    assert.throws(
      () => compile('{ ...SHARED }', "import { SHARED } from './shared';"),
      /card\.ts: .*host depends on 'SHARED', which is imported/s,
    );
  });

  it('compiles strings, a computed string key, class and style', () => {
    const host =
      "{ class: 'card', style: 'flex: 1', role: 'button', '[class.on]': 'on()', " +
      "'(press)': PRESS, ['[attr.data-z]']: 'on()' }";
    assert.ok(listens(compile(host, "const PRESS = 'go()';")));
  });
});
