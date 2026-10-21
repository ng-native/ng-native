import type { EngineNode } from '@ng-native/fabric';
import { attributeOf, isHtml, parentElement } from './element-tree.ts';
import { isInDocument } from './in-document.ts';

/**
 * An element's directionality, as HTML works it out for `:dir()`
 * (https://html.spec.whatwg.org/#the-directionality): its own `dir`, the first strong character
 * of its text where that is `auto`, or else that of the element it is in.
 */

type Direction = 'ltr' | 'rtl';

/**
 * Right to left: Hebrew, Arabic, Syriac, Thaana, N'Ko and the rest up to Arabic Extended, their
 * presentation forms, and the historic scripts of the planes above.
 */
const RTL: readonly (readonly [number, number])[] = [
  [0x0590, 0x08ff],
  [0xfb1d, 0xfdff],
  [0xfe70, 0xfeff],
  [0x10800, 0x10fff],
  [0x1e800, 0x1efff],
];

/**
 * Code points past Latin-1 that are no letter: the two signs of Latin-1, combining marks,
 * punctuation and symbols, and CJK punctuation.
 */
const NEUTRAL: readonly (readonly [number, number])[] = [
  [0xd7, 0xd7],
  [0xf7, 0xf7],
  [0x0300, 0x036f],
  [0x2000, 0x2bff],
  [0x3000, 0x303f],
];

const within = (code: number, ranges: readonly (readonly [number, number])[]): boolean =>
  ranges.some(([from, to]) => code >= from && code <= to);

/** The direction the first strong character of a text gives, or nothing where it has none. */
export function strongDirection(text: string): Direction | undefined {
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (within(code, RTL)) return 'rtl';
    // ponytail: a letter is strong left to right, and so is any code point past Latin-1 that is
    // not punctuation, a symbol or a combining mark. Bidi classes in full if a script needs one.
    if (/[A-Za-z]/.test(character) || (code >= 0xc0 && !within(code, NEUTRAL))) return 'ltr';
  }
  return undefined;
}

/** The kinds of `<input>` whose value gives the direction of `dir=auto`. */
const TEXT_VALUES = new Set([
  ...['hidden', 'text', 'search', 'tel', 'url', 'email', 'password', 'submit', 'reset'],
  'button',
]);

const typeOf = (node: EngineNode): string => (attributeOf(node, 'type') ?? 'text').toLowerCase();

/** The elements whose text `dir=auto` above them passes over. */
const PASSED_OVER = ['bdi', 'script', 'style', 'textarea'];

/** The first strong character of the text inside an element, as `dir=auto` reads it. */
function textDirection(node: EngineNode): Direction | undefined {
  for (const child of node.childList) {
    if (child.nodeKind === 'text') {
      const found = strongDirection(child.nodeText);
      if (found) return found;
      continue;
    }
    if (child.nodeKind !== 'element' || !isInDocument(child)) continue;
    const own = attributeOf(child, 'dir')?.toLowerCase();
    if (isHtml(child, ...PASSED_OVER) || own === 'ltr' || own === 'rtl' || own === 'auto') {
      continue;
    }
    const found = textDirection(child);
    if (found) return found;
  }
  return undefined;
}

/** `dir=auto`: from a field's value, or from the text inside. */
function autoDirection(node: EngineNode): Direction {
  const field =
    isHtml(node, 'textarea') || (isHtml(node, 'input') && TEXT_VALUES.has(typeOf(node)));
  const text = field ? String((node as unknown as { value?: unknown }).value ?? '') : null;
  return (text === null ? textDirection(node) : strongDirection(text)) ?? 'ltr';
}

export function directionOf(node: EngineNode): Direction {
  for (let at: EngineNode | null = node; at; at = parentElement(at)) {
    const dir = attributeOf(at, 'dir')?.toLowerCase();
    if (dir === 'ltr' || dir === 'rtl') return dir;
    if (dir === 'auto' || isHtml(at, 'bdi')) return autoDirection(at);
    // A telephone number is written left to right whatever is around it.
    if (isHtml(at, 'input') && typeOf(at) === 'tel') return 'ltr';
  }
  return 'ltr';
}
