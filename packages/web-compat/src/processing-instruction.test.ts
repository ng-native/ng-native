/**
 * `<?target data?>`, as `document.createProcessingInstruction` makes one: a node with a target
 * and words, told from a comment by its kind.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, DOCUMENT, inject } from '@angular/core';
import { cleanup, render, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** What a library sees of a node or a document: loosely typed, as its own code would be. */
type Dom = any;

@Component({ selector: 'x-page', template: `<div id="page"></div>` })
class Page {
  readonly document: Dom = inject(DOCUMENT);
}

afterEach(cleanup);

const page = async (): Promise<Dom> => {
  const app = await render(Page, { providers: [provideWebCompat()] });
  await settle();
  return app.fixture.componentInstance.document;
};

const nameOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as Error).name;
  }
  return 'none';
};

const globals = globalThis as Dom;

describe('processing instructions', () => {
  it('have a target and data, and are no comment', async () => {
    const document = await page();
    const pi = document.createProcessingInstruction('xml:x', 'a b');
    assert.deepEqual(
      [pi.nodeType, pi.nodeName, pi.target, pi.data, pi.length],
      [7, 'xml:x', 'xml:x', 'a b', 3],
    );
    assert.equal(pi.ownerDocument, document);
    assert.ok(pi instanceof globals.ProcessingInstruction);
    assert.ok(pi instanceof globals.CharacterData);
    assert.ok(!(pi instanceof globals.Comment));
    assert.ok(!(document.createComment('c') instanceof globals.ProcessingInstruction));
    pi.appendData('c');
    assert.equal(pi.data, 'a bc');
  });

  it('refuses a target that is no XML name, and data that would end it', async () => {
    const document = await page();
    for (const [target, data] of [
      ['A', '?>'],
      ['·A', 'x'],
      ['A×', 'x'],
      ['0', 'x'],
      ['\f', 'x'],
    ]) {
      assert.equal(
        nameOf(() => document.createProcessingInstruction(target, data)),
        'InvalidCharacterError',
        target,
      );
    }
    assert.equal(
      nameOf(() => document.createProcessingInstruction('A·A', 'x')),
      'none',
    );
  });

  it('is copied with its target, and written as markup', async () => {
    const document = await page();
    const pi = document.createProcessingInstruction('t', 'd');
    const copy = pi.cloneNode();
    assert.deepEqual([copy.nodeType, copy.target, copy.data], [7, 't', 'd']);
    const div = document.createElement('div');
    div.appendChild(pi);
    assert.equal(div.innerHTML, '<?t d>');
    assert.equal(new globals.XMLSerializer().serializeToString(pi), '<?t d?>');
  });

  it('is made by a document a script makes', async () => {
    const document = await page();
    const made = document.implementation.createDocument(null, 'r', null);
    const pi = made.createProcessingInstruction('t', 'd');
    assert.equal(pi.nodeType, 7);
    assert.equal(pi.ownerDocument, made);
  });
});
