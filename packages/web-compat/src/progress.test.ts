/**
 * A `<progress>` as Taiga UI draws one: the element is the track, and the bar it fills to its
 * value is styled as `::-webkit-progress-value`. With no value the bar is `:indeterminate`.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { setFlagsFromString } from 'node:v8';
import { Component, signal } from '@angular/core';
import { cleanup, compileCss, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

const SHEET = `
  progress { display: block; height: 12px; background: rgb(200, 200, 200); border-radius: 6px }
  progress::-webkit-progress-value { background: rgb(0, 0, 255); border-radius: 6px }
  progress::-moz-progress-bar { background: rgb(0, 0, 255) }
  progress::-WEBKIT-Progress-Value { opacity: 0.5 }
  progress::-MOZ-PROGRESS-BAR { border-width: 1px }
  progress:indeterminate { background: rgb(255, 0, 0) }
`;

@Component({
  selector: 'x-progress',
  template: `
    <!-- A positioned box around, which the bar is not placed against: its progress bar is. -->
    <div style="position: relative">
      <progress testID="bound" max="200" [value]="value()"></progress>
      <progress testID="written" max="4" value="1"></progress>
      <progress testID="unknown"></progress>
    </div>
    <div style="direction: rtl"><progress testID="rtl" value="1"></progress></div>
    @if (shown()) {
      <div><progress testID="held" value="1"></progress></div>
    }
  `,
})
class Progress {
  readonly value = signal<number | null>(50);
  readonly shown = signal(true);
}

/** Collect what nothing holds, as a long-running app's runtime does in time. */
async function collectGarbage(): Promise<void> {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  // A `WeakRef` holds what it refers to until the job that read it is over.
  await new Promise((resolve) => setTimeout(resolve, 0));
  gc();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(cleanup);

async function page() {
  const app = await render(Progress, {
    providers: [provideWebCompat()],
    globalStyles: compileCss(SHEET, 'global', { generated: true } as object) as never,
  });
  await settle();
  return app.instance;
}

const barOf = (id: string) => screen.getByTestId(id).children[0]!;

describe('a progress bar', () => {
  it('fills its bar to the share its value is of its max, styled as its value', async () => {
    await page();
    const bar = barOf('bound');
    assert.equal(bar.props['width'], '25%');
    assert.equal(bar.props['backgroundColor'], 'rgb(0, 0, 255)');
    // A pseudo-element's name is the same in capitals.
    assert.deepEqual([bar.props['opacity'], bar.props['borderWidth']], [0.5, 1]);
    assert.deepEqual(
      [bar.props['position'], bar.props['top'], bar.props['bottom'], bar.props['start']],
      ['absolute', 0, 0, 0],
    );
    assert.equal(barOf('written').props['width'], '25%');
    // The bar is placed in its progress bar, and not in the positioned box around.
    assert.equal(screen.getByTestId('bound').props['position'], 'relative');
  });

  it('follows its value, and is indeterminate with none', async () => {
    const progress = await page();
    progress.value.set(150);
    await settle();
    assert.equal(barOf('bound').props['width'], '75%');
    progress.value.set(null);
    await settle();
    assert.equal(barOf('bound').props['width'], '0%');
    assert.equal(screen.getByTestId('bound').props['backgroundColor'], 'rgb(255, 0, 0)');
    assert.equal(screen.getByTestId('unknown').props['backgroundColor'], 'rgb(255, 0, 0)');
    assert.equal(screen.getByTestId('written').props['backgroundColor'], 'rgb(200, 200, 200)');
  });

  it('keeps its bar from a script, and answers its value and position', async () => {
    await page();
    const document = (globalThis as { document?: any }).document;
    const bound = document.querySelector('[testID="bound"]');
    assert.equal(bound.children.length, 0);
    assert.equal(bound.value, 50);
    assert.equal(bound.max, 200);
    assert.equal(bound.position, 0.25);
    assert.equal(document.querySelector('[testID="unknown"]').position, -1);
  });

  it('refuses a value that is not a finite number, as a browser does', async () => {
    await page();
    const document = (globalThis as { document?: any }).document;
    const bound = document.querySelector('[testID="bound"]');
    assert.throws(() => (bound.value = Number.NaN), TypeError);
    assert.throws(() => (bound.value = Number.POSITIVE_INFINITY), TypeError);
    assert.equal(bound.value, 50);
    bound.value = '100';
    assert.equal(bound.value, 100);
  });

  it('fills from the inline start, the right in a box written right to left', async () => {
    await page();
    const bar = barOf('rtl');
    assert.deepEqual([bar.props['start'], bar.props['left']], [0, undefined]);
  });

  it('follows its value again once a script puts it back in the page', async () => {
    await page();
    const document = (globalThis as { document?: any }).document;
    const bound = document.querySelector('[testID="bound"]');
    const holder = bound.parentNode;
    holder.removeChild(bound);
    await settle();
    holder.appendChild(bound);
    bound.value = 150;
    await settle();
    assert.equal(barOf('bound').props['width'], '75%');
  });

  it('is let go of with the box it was in', async () => {
    const progress = await page();
    const document = (globalThis as { document?: any }).document;
    const held = new WeakRef(document.querySelector('[testID="held"]'));
    progress.shown.set(false);
    await settle();
    await collectGarbage();
    assert.ok(held.deref() === undefined, 'the progress bar is still held');
  });

  it('fills every bar a commit changes in one commit after it', async () => {
    await page();
    const document = (globalThis as { document?: any }).document;
    const engine = document.querySelector('[testID="bound"]').engine;
    for (const id of ['bound', 'written', 'unknown', 'rtl']) {
      document.querySelector(`[testID="${id}"]`).setAttribute('value', '2');
    }
    const before = engine.stats.commits;
    engine.commit();
    // The commit that changed the values, and one that filled every bar.
    assert.equal(engine.stats.commits - before, 2);
    assert.equal(barOf('written').props['width'], '50%');
    assert.equal(barOf('bound').props['width'], '1%');
  });
});
