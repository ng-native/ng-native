import type { EngineNode } from '@ng-native/fabric';
import { CANVAS_MEMBERS } from './canvas.ts';
import { datasetOf } from './dataset.ts';
import { nameOf } from './document.ts';
import { isFragment } from './document-fragment.ts';
import { ELEMENT_TEXT } from './element-text.ts';
import { FORM_METHODS } from './form.ts';
import { CONTROLS } from './form-controls.ts';
import { nameRecordOf, XHTML } from './qualified-name.ts';
import { own, type Reflecting, type Reflection } from './reflect.ts';
import { BY_ELEMENT, GLOBAL } from './reflected-attributes.ts';
import { FRAMES } from './frame.ts';
import { HYPERLINKS } from './hyperlink.ts';
import { STYLE_SHEETS } from './runtime-style.ts';
import { TABLE_PARTS } from './table-parts.ts';
import { SELECTION } from './text-selection.ts';
import { VALIDATION } from './validity.ts';
import { engineOf } from './window.ts';

/**
 * The properties of HTML elements, by element: what reflects an attribute
 * (`reflected-attributes.ts`), what a form control answers of itself (`form-controls.ts`,
 * `validity.ts`, `text-selection.ts`), a table's parts (`table-parts.ts`), a link's URL
 * (`hyperlink.ts`), an iframe's document and window (`frame.ts`), an element's `text`
 * (`element-text.ts`), a `<style>`'s `sheet` (`runtime-style.ts`), a `<canvas>`'s context and
 * size (`canvas.ts`), and `dataset`. Nodes share one prototype, so each property here asks
 * which element it is read on: one with nothing of its own for the name answers what the package
 * had for it before, and a text or an element of another namespace always does.
 */

type ByElement = Readonly<Record<string, Readonly<Record<string, Reflection>>>>;
/** What a node had for a name before these: a member of the package's, or nothing. */
type Before = PropertyDescriptor | undefined;

/** What every node answers, whatever it is. */
const EVERY_NODE: Readonly<Record<string, Reflection>> = {
  // There is no shadow DOM here, so nothing is slotted: a library walks up `parentNode` instead.
  assignedSlot: own(() => null),
};

const DATASET = own((element) => datasetOf(element as never));

/**
 * An element of HTML's: no text, no fragment, and none a script made in another namespace or a
 * template wrote in one, as it writes a drawing's in an `<svg>`.
 */
const isHtml = (node: EngineNode) => {
  if (node.nodeKind !== 'element' || isFragment(node)) return false;
  const name = nameRecordOf(node);
  return name ? name.namespace === XHTML : node.namespace === undefined;
};

/** Every name an element answers here. */
function namesOf(...tables: object[]): Set<string> {
  const names = new Set<string>();
  for (const table of tables) {
    for (const each of Object.values(table)) for (const name of Object.keys(each)) names.add(name);
  }
  return names;
}

/** For one property name: what each element answers, the most particular first, by name. */
function resolve(name: string, tables: readonly ByElement[]) {
  const byElement = new Map<string, Reflection>();
  const elements = new Set(tables.flatMap((table) => Object.keys(table)));
  for (const element of elements) {
    const own = tables.map((table) => table[element]?.[name]).find(Boolean);
    if (own) byElement.set(element, own);
  }
  const global = GLOBAL[name];
  // The page's body is a view, and has a body's own members, `bgColor` and the rest, as well.
  const body = byElement.get('body');
  return (node: EngineNode): Reflection | undefined => {
    if (!isHtml(node)) return undefined;
    if (body && node.tag === 'view' && nameOf(node, engineOf(node)) === 'body') return body;
    return byElement.get(node.tag) ?? global;
  };
}

const readBefore = (before: Before, node: object): unknown =>
  before?.get ? before.get.call(node) : before?.value;

/** Set a property a node has nothing to say of, as the node's own, as a plain object keeps one. */
function keepOwn(node: object, name: string, value: unknown): void {
  Object.defineProperty(node, name, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function member(name: string, before: Before, of: (node: EngineNode) => Reflection | undefined) {
  return {
    get(this: Reflecting) {
      const reflection = of(this);
      return reflection ? reflection.get(this) : readBefore(before, this);
    },
    set(this: Reflecting, value: unknown) {
      const reflection = of(this);
      if (reflection) reflection.set(this, value);
      else if (before?.set) before.set.call(this, value);
      else keepOwn(this, name, value);
    },
    configurable: true,
  };
}

/** The members of `base` with the HTML properties over them, for `extendNodes`. */
export function withHtmlMembers(base: PropertyDescriptorMap): PropertyDescriptorMap {
  const tables: ByElement[] = [
    CONTROLS,
    FORM_METHODS,
    VALIDATION,
    SELECTION,
    TABLE_PARTS,
    HYPERLINKS,
    FRAMES,
    ELEMENT_TEXT,
    STYLE_SHEETS,
    CANVAS_MEMBERS,
    BY_ELEMENT,
  ];
  const names = new Set([...Object.keys(GLOBAL), ...namesOf(...tables)]);
  const members: PropertyDescriptorMap = { ...base };
  for (const name of names) members[name] = member(name, base[name], resolve(name, tables));
  for (const [name, reflection] of Object.entries(EVERY_NODE)) {
    members[name] = member(name, base[name], () => reflection);
  }
  members['dataset'] = member('dataset', base['dataset'], (node) =>
    node.nodeKind === 'element' ? DATASET : undefined,
  );
  return members;
}
