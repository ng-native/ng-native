/**
 * `injectService` under Node's own test runner: the calls in one test share an app, and the next
 * test starts another without anyone calling `cleanup()`, as under Vitest.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Service, inject, signal } from '@angular/core';
import { injectService } from '@ng-native/testing';

@Service()
class Counter {
  readonly count = signal(0);
}

@Service()
class Clicker {
  private readonly counter = inject(Counter);
  click = () => this.counter.count.update((n) => n + 1);
}

describe('injectService', () => {
  let earlier: Counter | undefined;

  it('gives a service and the service it injects one root', () => {
    const clicker = injectService(Clicker);
    earlier = injectService(Counter);
    clicker.click();
    assert.equal(earlier.count(), 1);
  });

  it('starts another app in the next test, with no cleanup between them', () => {
    assert.ok(earlier);
    const counter = injectService(Counter);
    assert.notEqual(counter, earlier);
    assert.equal(counter.count(), 0);
  });
});

describe('injectService, in tests that run at once', { concurrency: 2 }, () => {
  const made: Counter[] = [];
  let started = () => {};
  const both = new Promise<void>((resolve) => (started = resolve));
  const run = async () => {
    made.push(injectService(Counter));
    if (made.length === 2) started();
    await both;
    made.push(injectService(Counter));
  };

  it('gives one test no app of another that is still running', run);
  it('and the other none of the first', run);
  it('so no two of their services are the same', () => {
    assert.equal(new Set(made).size, 4);
  });
});
