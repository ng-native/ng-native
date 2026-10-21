import type { Engine, EngineNode } from '@ng-native/fabric';
import { domError, required } from './dom-error.ts';
import { inDocument } from './in-document.ts';
import { dataChanged } from './mutation-observer.ts';
import { engineOf } from './window.ts';

/**
 * The words of a text and of a comment, as the DOM's `CharacterData` has them. A comment is the
 * engine's anchor, which is never drawn: its words are kept on it, where nothing draws them, so
 * a library reads back what it wrote. An anchor Angular makes has none.
 */

/** Whether a node has words of its own: a text or a comment. */
export const isCharacterData = (node: EngineNode): boolean =>
  node.nodeKind === 'text' || node.nodeKind === 'anchor';

/** A comment holding `data`, as `document.createComment` makes one. */
export function createComment(engine: Engine, data: unknown): EngineNode {
  const comment = engine.createAnchor();
  comment.nodeText = String(data);
  return comment;
}

/** What `data` is given as words: `null` is none, as `[LegacyNullToEmptyString]` has it. */
export const wordsOf = (value: unknown): string => (value === null ? '' : String(value));

/** Set the words of a text or a comment. An element has none of its own, and is left as it is. */
export function setData(node: EngineNode, words: string): void {
  if (node.nodeKind === 'text') engineOf(node).setText(node, words);
  else if (node.nodeKind === 'anchor') {
    const old = node.nodeText;
    node.nodeText = words;
    dataChanged(node, old);
  }
}

const TWO_TO_32 = 2 ** 32;

/** A number as WebIDL's `unsigned long` takes it: whole, and wrapped into 0 to 2^32 - 1. */
export function unsignedLong(value: unknown): number {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return 0;
  const wrapped = number % TWO_TO_32;
  return wrapped < 0 ? wrapped + TWO_TO_32 : wrapped;
}

/** An offset into the words, which may be at their end and no further. */
function offsetIn(words: string, value: unknown): number {
  const offset = unsignedLong(value);
  if (offset > words.length) {
    throw domError(`The offset ${offset} is past the length ${words.length}.`, 'IndexSizeError');
  }
  return offset;
}

/** `replaceData`, which the other changes are each a case of. */
function replaceData(node: EngineNode, at: unknown, count: unknown, more: string): void {
  const words = node.nodeText;
  const from = offsetIn(words, at);
  const to = Math.min(words.length, from + unsignedLong(count));
  setData(node, words.slice(0, from) + more + words.slice(to));
}

type Dom = EngineNode;
const get = (read: (this: Dom) => unknown, write?: (this: Dom, value: unknown) => void) => ({
  get: read,
  set: write,
});
const method = (value: (this: Dom, ...args: unknown[]) => unknown) => ({ value, writable: true });

/** The texts side by side with a text, itself among them, in their order. */
function textsBeside(node: EngineNode): EngineNode[] {
  const siblings = node.parent ? inDocument(node.parent) : [node];
  let from = siblings.indexOf(node);
  let to = from;
  while (siblings[from - 1]?.nodeKind === 'text') from--;
  while (siblings[to + 1]?.nodeKind === 'text') to++;
  return siblings.slice(from, to + 1);
}

/** `splitText`: the words from `at` on taken out into a text of their own, put after it. */
function splitText(node: EngineNode, at: unknown): EngineNode {
  const words = node.nodeText;
  const from = offsetIn(words, at);
  const engine = engineOf(node);
  const rest = engine.createText(words.slice(from));
  const parent = node.parent;
  if (parent) {
    const after = parent.childList[parent.childList.indexOf(node) + 1] ?? null;
    engine.insertBefore(parent, rest, after);
  }
  setData(node, words.slice(0, from));
  return rest;
}

/** The members of a text and a comment. An element answers none of them. */
export const characterDataMembers: PropertyDescriptorMap = {
  data: get(
    function () {
      return isCharacterData(this) ? this.nodeText : undefined;
    },
    function (value) {
      setData(this, wordsOf(value));
    },
  ),
  // A text's, and no element's: a library tells a list from an element by whether it has one.
  length: get(function () {
    return isCharacterData(this) ? this.nodeText.length : undefined;
  }),
  substringData: method(function (...args) {
    required(args, 2, 'substringData');
    const from = offsetIn(this.nodeText, args[0]);
    return this.nodeText.slice(from, from + unsignedLong(args[1]));
  }),
  appendData: method(function (...args) {
    required(args, 1, 'appendData');
    setData(this, this.nodeText + String(args[0]));
  }),
  insertData: method(function (...args) {
    required(args, 2, 'insertData');
    replaceData(this, args[0], 0, String(args[1]));
  }),
  deleteData: method(function (...args) {
    required(args, 2, 'deleteData');
    replaceData(this, args[0], args[1], '');
  }),
  splitText: method(function (...args) {
    required(args, 1, 'splitText');
    return splitText(this, args[0]);
  }),
  // A text's words with those of the texts either side of it.
  wholeText: get(function () {
    if (this.nodeKind !== 'text') return undefined;
    return textsBeside(this)
      .map((text) => text.nodeText)
      .join('');
  }),
  replaceData: method(function (...args) {
    required(args, 3, 'replaceData');
    replaceData(this, args[0], args[1], String(args[2]));
  }),
};
