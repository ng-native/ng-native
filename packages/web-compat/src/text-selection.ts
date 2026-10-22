import type { EngineNode } from '@ng-native/fabric';
import { select as keepSelected } from './copy-command.ts';
import { domError } from './dom-error.ts';
import { selectNatively } from './field.ts';
import { method, own, type Reflecting, type Reflection } from './reflect.ts';
import { engineOf } from './window.ts';

/**
 * Where the selection is in a text field: `selectionStart`, `selectionEnd`,
 * `selectionDirection` and `setSelectionRange()`. An input mask reads where the caret is before
 * it rewrites the value and puts the caret back after; a selection set here is set on the native
 * field too.
 *
 * ponytail: what a person selects in the native field is not heard. A selection set here holds
 * until the text changes; with none, or after, the caret is at the end of the text, which is
 * where typing leaves it. Hear the field's selection changes if a library is seen to read the
 * caret in the middle of what was typed.
 */

type Field = Reflecting & { value?: unknown };

interface Selection {
  start: number;
  end: number;
  direction: string;
  /** The text it was set on: once the text is other, it is gone. */
  text: string;
}

const selections = new WeakMap<EngineNode, Selection>();

/** The input types a selection is of: the others answer `null`, and throw if one is set. */
const SELECTABLE = new Set(['text', 'search', 'url', 'tel', 'password']);

const selectable = (node: Field) =>
  node.tag === 'textarea' ||
  (node.tag === 'input' && SELECTABLE.has((node.getAttribute('type') ?? 'text').toLowerCase()));

const textOf = (node: Field) => String(node.value ?? '');

/** Where the selection is now: the one set, while its text is the field's, or the end. */
function current(node: Field): Selection {
  const text = textOf(node);
  const kept = selections.get(node);
  if (kept && kept.text === text) return kept;
  return { start: text.length, end: text.length, direction: 'none', text };
}

const DIRECTIONS = new Set(['forward', 'backward']);

function setRange(node: Field, from: unknown, to: unknown, direction?: unknown): void {
  if (!selectable(node)) {
    throw domError('The input element does not support selection.', 'InvalidStateError');
  }
  const text = textOf(node);
  const end = Math.min(Number(to) >>> 0, text.length);
  const start = Math.min(Number(from) >>> 0, end);
  const named = String(direction);
  selections.set(node, {
    start,
    end,
    direction: DIRECTIONS.has(named) ? named : 'none',
    text,
  });
  selectNatively(node, start, end, engineOf(node));
}

/** A member of a selectable field, or `null` for an input of another type. */
const ofField = (read: (at: Selection) => unknown, write: (node: Field, value: unknown) => void) =>
  own(
    (node) => (selectable(node) ? read(current(node)) : null),
    (node, value) => write(node, value),
  );

const MEMBERS: Readonly<Record<string, Reflection>> = {
  selectionStart: ofField(
    (at) => at.start,
    (node, value) => {
      const at = current(node);
      setRange(node, value, Math.max(Number(value) >>> 0, at.end), at.direction);
    },
  ),
  selectionEnd: ofField(
    (at) => at.end,
    (node, value) => {
      const at = current(node);
      setRange(node, at.start, value, at.direction);
    },
  ),
  selectionDirection: ofField(
    (at) => at.direction,
    (node, value) => {
      const at = current(node);
      setRange(node, at.start, at.end, value);
    },
  ),
  setSelectionRange: method(function (
    this: Field,
    from: unknown,
    to: unknown,
    direction?: unknown,
  ) {
    setRange(this, from, to, direction);
  }),
  // The whole text, and the field kept as the one a copy takes: one with no text to select is not.
  select: method(function (this: Field) {
    if (!selectable(this)) return;
    keepSelected(engineOf(this), this);
    setRange(this, 0, textOf(this).length);
  }),
};

/** The selection members, by element. */
export const SELECTION: Readonly<Record<string, typeof MEMBERS>> = {
  input: MEMBERS,
  textarea: MEMBERS,
};
