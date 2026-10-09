/**
 * A typo'd element name, reported rather than rendered as an empty view.
 *
 * Every element name reaches the engine the same way, through `createElement`, so the name alone
 * cannot tell `<veiw>` from `<x-card>`: both are names no table has heard of. What tells them
 * apart is Angular, which hands the renderer factory every component host it creates and every
 * template's directive registry, so a name is unknown only when no view table, no component and
 * no element selector anywhere in the app accounts for it.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Engine, markComponentHost } from '@ng-native/fabric';
import { mount } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function capture(run: () => void | Promise<void>): Promise<string[]> {
  const reports: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => reports.push(args.map(String).join(' '));
  return Promise.resolve()
    .then(run)
    .then(
      () => {
        console.error = original;
        return reports;
      },
      (error: unknown) => {
        console.error = original;
        throw error;
      },
    );
}

describe('an element nothing accounts for, on the engine', () => {
  it('is reported once per name in dev, naming the element', async () => {
    const reports = await capture(() => {
      const engine = new Engine(createFakeFabric(), 1, { dev: true });
      engine.appendChild(engine.root, engine.createElement('veiw'));
      engine.appendChild(engine.root, engine.createElement('veiw'));
      engine.commit();
    });
    assert.equal(reports.length, 1);
    assert.match(reports[0]!, /<veiw>/);
    assert.match(reports[0]!, /empty view/);
  });

  it('is silent for a component host, a declared element, and outside dev', async () => {
    const reports = await capture(() => {
      const engine = new Engine(createFakeFabric(), 1, { dev: true });
      const card = engine.createElement('x-card');
      markComponentHost(card);
      engine.appendChild(engine.root, card);
      engine.declareElement('x-slot');
      engine.appendChild(engine.root, engine.createElement('x-slot'));
      engine.commit();

      const release = new Engine(createFakeFabric(), 1);
      release.appendChild(release.root, release.createElement('veiw'));
      release.commit();
    });
    assert.deepEqual(reports, []);
  });
});

describe('an element nothing accounts for, in an app', () => {
  let mod: Record<string, unknown>;

  before(async () => {
    mod = await compileFixture('fixtures/unknown-element.ts');
  });

  it('reports a typo on first commit, once', async () => {
    const reports = await capture(async () => {
      mount(1, mod['Typo'] as Type<unknown>, createFakeFabric(), { dev: true });
      await settle();
    });
    assert.equal(reports.length, 1, reports.join('\n'));
    assert.match(reports[0]!, /<veiw>/);
  });

  it('says nothing about component hosts, attribute-selector hosts or directive elements', async () => {
    const reports = await capture(async () => {
      const app = mount(1, mod['KnownElements'] as Type<unknown>, createFakeFabric(), {
        dev: true,
      });
      await settle();
      // A host created after the first commit is committed later, and must be known by then.
      (app.componentRef.instance as { late: { set(v: boolean): void } }).late.set(true);
      await settle();
    });
    assert.deepEqual(reports, []);
  });
});
