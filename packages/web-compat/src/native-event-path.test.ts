/**
 * An event native says, as a listener a script added hears it: a DOM event with the members a
 * library reads, whichever way it is attached. Taiga UI's dropdown reads `composedPath()[0]` of
 * the `focusin` its text field hears when a field in it takes the focus.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, fireEvent, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

type Dom = any;

@Component({
  selector: 'x-fields',
  template: `<div id="box"><input id="field" testID="field" /></div>`,
})
class Fields {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

describe('an event native says, heard by a listener a script added', () => {
  it('is a DOM event with the path it went up, on the field and on what holds it', async () => {
    const app = await render(Fields, { providers: [provideWebCompat()] });
    await settle();
    const document = app.fixture.componentInstance.document;
    const [box, field] = [document.getElementById('box'), document.getElementById('field')];
    const heard: [string, unknown, unknown, unknown][] = [];
    const note = (where: string) => (event: Dom) =>
      heard.push([where, event.composedPath()[0], event.target, event.currentTarget]);
    box.addEventListener('focusin', note('box'));
    field.addEventListener('focusin', note('field'));
    await fireEvent(screen.getByTestId('field'), 'focus', { nativeEvent: {} });
    assert.deepEqual(heard, [
      ['field', field, field, field],
      ['box', field, field, box],
    ]);
  });

  it('goes up from its target in a listener that native names another way', async () => {
    const app = await render(Fields, { providers: [provideWebCompat()] });
    await settle();
    const document = app.fixture.componentInstance.document;
    const field = document.getElementById('field');
    let path: unknown[] = [];
    field.addEventListener('blur', (event: Dom) => (path = event.composedPath()));
    await fireEvent(screen.getByTestId('field'), 'blur', { nativeEvent: {} });
    assert.equal(path[0], field);
    assert.equal(path[1], document.getElementById('box'));
  });
  it('goes up to the document and the window from a field in the page', async () => {
    const app = await render(Fields, { providers: [provideWebCompat()] });
    await settle();
    const document = app.fixture.componentInstance.document;
    let path: unknown[] = [];
    document.getElementById('field').addEventListener('focusin', (event: Dom) => {
      path = event.composedPath();
    });
    await fireEvent(screen.getByTestId('field'), 'focus', { nativeEvent: {} });
    // Compared one by one: a failure would print the whole document and window.
    assert.ok(path.at(-2) === document, 'the document');
    assert.ok(path.at(-1) === globalThis, 'the window');
    assert.ok(path.includes(document.body), 'the body');
  });

  it('keeps the path it went up after a listener takes the field out', async () => {
    const app = await render(Fields, { providers: [provideWebCompat()] });
    await settle();
    const document = app.fixture.componentInstance.document;
    const [box, field] = [document.getElementById('box'), document.getElementById('field')];
    const paths: unknown[][] = [];
    field.addEventListener('focusin', (event: Dom) => {
      field.remove();
      paths.push(event.composedPath());
    });
    field.addEventListener('focusin', (event: Dom) => paths.push(event.composedPath()));
    await fireEvent(screen.getByTestId('field'), 'focus', { nativeEvent: {} });
    assert.equal(paths.length, 2);
    for (const path of paths) assert.ok(path[0] === field && path[1] === box, 'its box kept');
    // A copy each time, as a browser's is.
    assert.ok(paths[0] !== paths[1], 'a copy each time');
  });
});
