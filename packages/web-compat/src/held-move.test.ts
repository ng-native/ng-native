/**
 * An element moved while a finger is on it: the move is in the document at once, and reaches
 * native once the finger lifts. A native view moved to another parent loses its touch, and a
 * library that drags an element moves it as the drag begins: CDK's drag and drop puts it on the
 * body, out of sight, with a placeholder where it was.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { cleanup, render, screen, settle, type FakeFabricNode } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

afterEach(cleanup);

type Dom = any;

@Component({
  template: `<div id="list">
      <div id="item" testID="item"><span>Drag me</span></div>
      <div id="next"></div>
    </div>
    <div id="elsewhere" testID="elsewhere"></div>
    <div id="other"></div>`,
})
class Page {}

const page = async () => {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  const document = (globalThis as Dom).document;
  const [list, item, next, elsewhere, other] = ['list', 'item', 'next', 'elsewhere', 'other'].map(
    (id) => document.getElementById(id),
  );
  /** The views native has, by the element each is, and the element each is committed under. */
  const committed = () => {
    const under = new Map<unknown, unknown>();
    const views = new Map<unknown, FakeFabricNode>();
    const walk = (nodes: readonly FakeFabricNode[], parent: unknown) => {
      for (const node of nodes) {
        views.set(node.instanceHandle, node);
        under.set(node.instanceHandle, parent);
        walk(node.children, node.instanceHandle);
      }
    };
    walk(app.fabric.committed, null);
    return { under, views };
  };
  /** The element an element's view is committed under, once the change in hand has committed. */
  const committedUnder = async (element: unknown) => {
    await settle();
    const parent = committed().under.get(element) as Dom;
    // By its name: an element is too large to show in a failed assertion.
    return parent ? parent.id || parent.localName : null;
  };
  const viewOf = (element: unknown) => committed().views.get(element);
  /** A finger coming down on, or lifting from, the element whose test id is given. */
  const finger = (testID: string, phase: 'Start' | 'Move' | 'End' | 'Cancel') => {
    // Found among the views native has: one taken out of the document is still drawn.
    const view = [...committed().views.values()].find((each) => each.props['testID'] === testID)!;
    const point = { identifier: 0, target: view.reactTag, pageX: 10, pageY: 10 };
    app.fabric.emit(view, `topTouch${phase}`, {
      ...point,
      touches: phase === 'Start' || phase === 'Move' ? [point] : [],
      changedTouches: [point],
    });
  };
  const placeholder = document.createElement('div');
  placeholder.id = 'placeholder';
  /** The elements the views committed under an element's are, by their ids. */
  const committedIn = (element: unknown) =>
    viewOf(element)!.children.map((child) => (child.instanceHandle as Dom).id);
  /** What CDK does as a drag begins. */
  const drag = () => document.body.appendChild(list.replaceChild(placeholder, item));
  return {
    app,
    document,
    list,
    item,
    next,
    elsewhere,
    other,
    placeholder,
    finger,
    drag,
    viewOf,
    committedUnder,
    committedIn,
  };
};

describe('@ng-native/web-compat, an element moved while a finger is on it', () => {
  it('stays where it was committed until the finger lifts, and is in the document where it was put', async () => {
    const { document, list, item, placeholder, finger, drag, viewOf, committedUnder, committedIn } =
      await page();
    const view = viewOf(item)!;
    finger('item', 'Start');
    drag();
    assert.ok(item.parentNode === document.body, 'moved in the document at once');
    assert.ok(placeholder.parentNode === list);
    assert.equal(await committedUnder(item), 'list', 'and left where it is for the touch');
    assert.equal(viewOf(item)!.reactTag, view.reactTag, 'the same view');
    assert.equal(await committedUnder(placeholder), 'list');
    assert.deepEqual(committedIn(list), ['placeholder', 'item', 'next'], 'where it was');
    finger('item', 'End');
    assert.equal(await committedUnder(item), 'body', 'moved once the finger lifts');
  });

  it('is drawn as it is styled while it is held', async () => {
    const { item, finger, drag, viewOf, committedUnder } = await page();
    finger('item', 'Start');
    drag();
    item.style.opacity = '0';
    assert.equal(await committedUnder(item), 'list');
    assert.equal(viewOf(item)!.props['opacity'], 0);
    item.style.opacity = '0.5';
    await committedUnder(item);
    assert.equal(viewOf(item)!.props['opacity'], 0.5, 'and as it is styled again');
    finger('item', 'End');
  });

  it('moves at once with no finger down, or with one on something else', async () => {
    const { document, item, finger, drag, committedUnder } = await page();
    drag();
    assert.equal(await committedUnder(item), 'body');
    document.getElementById('list').appendChild(item);
    finger('elsewhere', 'Start');
    drag();
    assert.equal(await committedUnder(item), 'body');
    finger('elsewhere', 'End');
  });

  it('moves once a touch that is cancelled ends', async () => {
    const { item, finger, drag, committedUnder } = await page();
    finger('item', 'Start');
    drag();
    assert.equal(await committedUnder(item), 'list');
    finger('item', 'Cancel');
    assert.equal(await committedUnder(item), 'body');
  });

  it('is put back with the view it had, where it is put back before the finger lifts', async () => {
    const { list, item, placeholder, finger, drag, viewOf, committedUnder } = await page();
    const view = viewOf(item)!;
    finger('item', 'Start');
    drag();
    await settle();
    list.replaceChild(item, placeholder);
    finger('item', 'End');
    assert.equal(await committedUnder(item), 'list');
    assert.equal(viewOf(item)!.reactTag, view.reactTag);
    assert.ok(!viewOf(placeholder));
  });

  it('is still told of the finger taken out of the document, until it lifts', async () => {
    // As a browser sends a touch's events to where it began, in the document or not.
    const { document, item, finger, drag } = await page();
    const heard: string[] = [];
    for (const type of ['touchmove', 'touchend']) {
      item.addEventListener(type, () => heard.push(type));
    }
    finger('item', 'Start');
    drag();
    document.body.removeChild(item);
    await settle();
    finger('item', 'Move');
    finger('item', 'End');
    await settle();
    assert.deepEqual(heard, ['touchmove', 'touchend']);
  });

  it('is drawn where it is once the parent it was held under leaves the page', async () => {
    const { document, list, item, elsewhere, finger, committedUnder } = await page();
    finger('item', 'Start');
    elsewhere.appendChild(item);
    assert.equal(await committedUnder(item), 'list', 'held while the finger is down');
    list.remove();
    assert.equal(await committedUnder(item), 'elsewhere', 'not lost with the list');
    finger('item', 'End');
    assert.equal(await committedUnder(item), 'elsewhere');
    void document;
  });

  it('goes once the finger lifts, where it is taken out of the document', async () => {
    const { document, list, item, finger, drag, viewOf, committedUnder } = await page();
    const view = viewOf(item)!;
    finger('item', 'Start');
    drag();
    document.body.removeChild(item);
    assert.ok(item.parentNode === null);
    assert.equal(await committedUnder(item), 'list', 'still under the finger');
    finger('item', 'End');
    await settle();
    assert.ok(!viewOf(item), 'gone once the finger lifts');
    // Put back, it is a view made again: native hears nothing on one it has taken down.
    list.appendChild(item);
    assert.equal(await committedUnder(item), 'list');
    assert.notEqual(viewOf(item)!.reactTag, view.reactTag);
  });

  it('ends where it was last put, moved twice', async () => {
    const { other, item, finger, drag, committedUnder } = await page();
    finger('item', 'Start');
    drag();
    await settle();
    other.appendChild(item);
    assert.equal(await committedUnder(item), 'list');
    finger('item', 'End');
    assert.equal(await committedUnder(item), 'other');
  });

  it('is held no longer once it is destroyed, and goes where it is put back', async () => {
    // Angular destroys the nodes of a view it takes out, and puts projected content back.
    const { other, item, finger, drag, committedUnder } = await page();
    finger('item', 'Start');
    drag();
    await settle();
    item.engine.destroyNode(item);
    other.appendChild(item);
    assert.equal(await committedUnder(item), 'other');
    finger('item', 'End');
  });

  it('holds nothing once the app is gone', async () => {
    const { item, finger, drag } = await page();
    const engine = item.engine;
    finger('item', 'Start');
    drag();
    await settle();
    assert.equal(engine.heldMoves.size, 1, 'held while the app is up');
    cleanup();
    assert.equal(engine.heldMoves.size, 0);
  });
});

/** A list in a page that scrolls. */
@Component({
  template: `<div testID="page" style="overflow: auto">
    <div id="list"><div id="item" testID="item"></div></div>
  </div>`,
})
class Scrolling {}

describe('@ng-native/web-compat, a drag kept from the page by an element moved as it is kept', () => {
  it('holds the page the element was in still, until the finger lifts', async () => {
    const app = await render(Scrolling, { providers: [provideWebCompat()] });
    await settle();
    const engine = app.componentRef.injector.get(Engine);
    const document = (globalThis as Dom).document;
    const item = document.getElementById('item');
    const view = screen.getByTestId('item');
    // What CDK's drag and drop does in the move that starts a drag: it puts the item on the
    // body, reads where things are, which commits, and prevents the move's default.
    item.addEventListener('touchmove', (event: Dom) => {
      if (item.parentNode !== document.body) document.body.appendChild(item);
      item.getBoundingClientRect();
      event.preventDefault();
    });
    const send = (phase: 'Start' | 'Move' | 'End', pageY: number) => {
      const touch = { identifier: 0, target: view.reactTag, pageX: 10, pageY };
      app.fabric.emit(view, `topTouch${phase}`, {
        ...touch,
        touches: phase === 'End' ? [] : [touch],
        changedTouches: [touch],
      });
    };
    const scrolls = () => {
      engine.commit();
      return screen.getByTestId('page').props['scrollEnabled'] !== false;
    };
    send('Start', 10);
    send('Move', 40);
    assert.equal(scrolls(), false, 'held still');
    send('Move', 80);
    assert.equal(scrolls(), false, 'for every move');
    send('End', 80);
    assert.equal(scrolls(), true, 'and given back once the finger lifts');
  });
});
