/**
 * What a library puts over the app, under the body, is not seen until the frame after it is put
 * there. A browser paints once the task and its animation frame are over, by when an overlay has
 * been measured and given the class it is shown with; native draws each commit as it comes, so
 * an overlay drawn at once is seen for a frame as it was inserted. And it stays a view of its
 * own, which native does not flatten away.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees: loosely typed, as its own code would be against the DOM. */
type Dom = any;

@Component({ selector: 'x-page', template: '<div id="card" testID="card"></div>' })
class Page {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

async function page() {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  const document: Dom = app.fixture.componentInstance.document;
  const div = (id: string, parent: Dom = document.body, style = '') => {
    const element = document.createElement('div');
    element.setAttribute('testID', id);
    if (style) element.setAttribute('style', style);
    parent.appendChild(element);
    return element;
  };
  /** What the element is committed with, as a library measuring it has it committed. */
  const seen = (element: Dom) => {
    element.getBoundingClientRect();
    const props = screen.queryByTestId(element.getAttribute('testID'), {
      includeHiddenElements: true,
    })?.props;
    if (!props) return null;
    const { opacity = null, pointerEvents = null } = props;
    return { opacity, pointerEvents };
  };
  return { app, document, div, seen };
}

/** A frame, and the timers waiting at its end, which is where the hold is let go. */
const aFrame = async () => {
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
};

describe('what a library inserts under the body', () => {
  it('is committed unseen and untouched, and as it is from the frame after', async () => {
    const { div, seen } = await page();
    const pane = div('pane');
    assert.deepEqual(seen(pane), { opacity: 0, pointerEvents: 'none' });
    await aFrame();
    assert.deepEqual(seen(pane), { opacity: null, pointerEvents: 'auto' });
  });

  it('keeps an opacity of its own, and one it is given before it is seen', async () => {
    const { div, seen } = await page();
    const pane = div('pane', undefined, 'opacity: 0.5');
    assert.equal(seen(pane)?.opacity, 0);
    pane.style.opacity = '0.25';
    assert.equal(seen(pane)?.opacity, 0);
    await aFrame();
    assert.equal(seen(pane)?.opacity, 0.25);
  });

  it('holds only the outermost of what is put in at once, which hides the rest', async () => {
    // A hold of its own would be a second say in its opacity, beside an animation it opens with.
    const { div, seen } = await page();
    const container = div('container');
    const pane = div('pane', container, 'opacity: 0.5');
    assert.equal(seen(container)?.opacity, 0);
    assert.equal(seen(pane)?.opacity, 0.5);
    await aFrame();
    assert.equal(seen(container)?.opacity, null);
    // What is seen already is moved as it is, and the next one put in it is the one held.
    container.appendChild(pane);
    assert.equal(seen(pane)?.opacity, 0.5);
    const next = div('next', container, 'opacity: 0.5');
    assert.equal(seen(next)?.opacity, 0);
    await aFrame();
    assert.equal(seen(next)?.opacity, 0.5);
  });

  it('leaves nothing behind when it is taken out before the frame, and is held if put back', async () => {
    const { app, document, div, seen } = await page();
    const pane = div('pane');
    assert.equal(seen(pane)?.opacity, 0);
    document.body.removeChild(pane);
    await settle();
    const commits = app.fabric.calls.completeRoot;
    await aFrame();
    assert.equal(app.fabric.calls.completeRoot, commits, 'nothing committed for it');
    assert.equal(seen(pane), null);
    document.body.appendChild(pane);
    assert.equal(seen(pane)?.opacity, 0);
    await aFrame();
    assert.equal(seen(pane)?.opacity, null);
  });

  it('is drawn at once where it is put in the app instead', async () => {
    const { document, div, seen } = await page();
    const ripple = div('ripple', document.getElementById('card'), 'opacity: 0.5');
    assert.deepEqual(seen(ripple), { opacity: 0.5, pointerEvents: null });
  });
});

describe('what a library puts over the app', () => {
  it('stays a view of its own, unless it is written otherwise', async () => {
    // An overlay's host and container have no size or paint of their own, and native flattens
    // such a view away. What is in it is placed by the library from one commit to the next,
    // and under a parent that is no view native draws it out of place: a sheet at the foot of
    // the screen, its own height too high the second time it opens.
    const { document, div } = await page();
    const host = div('host');
    const container = div('container', host);
    const written = document.createElement('div');
    written.setAttribute('testID', 'written');
    written.setAttribute('collapsable', 'true');
    host.appendChild(written);
    const inApp = div('in-app', document.getElementById('card'));
    await aFrame();
    const kept = (element: Dom) =>
      screen.getByTestId(element.getAttribute('testID'), { includeHiddenElements: true }).props[
        'collapsable'
      ];
    assert.equal(kept(host), false);
    assert.equal(kept(container), false);
    assert.notEqual(kept(written), false);
    assert.equal(kept(inApp), undefined);
  });
});
