/**
 * The one table of DOM events, in `@ng-native/metro`, which `@ng-native/eslint-plugin`'s rules and
 * the build both read, and the runtime's names for the events a desktop sends, which have to agree
 * with it.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { DOM_EVENT_TYPES } from '@ng-native/fabric';

const require = createRequire(import.meta.url);
const { DOM_EVENTS } = require('@ng-native/metro/dom-events.cjs') as {
  DOM_EVENTS: Map<string, { instead: string; desktop?: string }>;
};
const { transformAngular } = require('@ng-native/metro/angular-transform.cjs');

describe('the DOM event table', () => {
  it('names each desktop event the engine event the runtime listens for, and no other', () => {
    const desktop = Object.fromEntries(
      [...DOM_EVENTS].filter(([, one]) => one.desktop).map(([name, one]) => [name, one.desktop]),
    );
    assert.deepEqual(desktop, DOM_EVENT_TYPES);
  });
});

describe('the build', () => {
  const warnings = (template: string, host = '{}', platform = 'ios') => {
    const said: string[] = [];
    const warn = console.warn;
    console.warn = (message: string) => void said.push(message);
    try {
      transformAngular(
        `import { Component } from '@angular/core';
@Component({ selector: 'app-card', template: '${template}', host: ${host} })
export class Card { go() {} }`,
        '/app/src/card.ts',
        { platform },
      );
    } finally {
      console.warn = warn;
    }
    return said.filter((message) => message.includes('never fires'));
  };

  it('warns of a DOM event no device sends, on a native element, with what to use', () => {
    assert.deepEqual(
      warnings('<view (click)="go()"><text-input (keydown.enter)="go()" /></view>'),
      [
        '[angular-native] /app/src/card.ts: (click) on <view> is a DOM event and never fires on a ' +
          'device. Use (press) on a <pressable>, or <text pressable (press)="...">.',
        '[angular-native] /app/src/card.ts: (keydown.enter) on <text-input> is a DOM event and never ' +
          'fires on a device. Use (keyPress) or (submitEditing) on a <text-input>.',
      ],
    );
  });

  it("warns of one on a component's own host", () => {
    assert.equal(warnings('', "{ '(click)': 'go()' }").length, 1);
  });

  it("leaves a desktop's events, a component's outputs and the web alone", () => {
    assert.deepEqual(warnings('<view (mouseenter)="go()" (dblclick)="go()" (wheel)="go()" />'), []);
    assert.deepEqual(warnings('<app-list (drag)="go()" />'), []);
    assert.deepEqual(warnings('<view (click)="go()" />', '{}', 'web'), []);
  });
});
