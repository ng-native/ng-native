import type { Engine, EngineNode } from '@ng-native/fabric';
import type { Renderer2 } from '@angular/core';
import { attributeRemoved } from './attr.ts';
import { canvasAttributes, isCanvasBox } from './canvas.ts';
import { isCDATASection } from './cdata-section.ts';
import { isCharacterData, setData, wordsOf } from './character-data.ts';
import { classAttribute, classListOf, setClassAttribute } from './class-list.ts';
import { inXmlDocument, madeDocumentOf } from './created-document.ts';
import { documentOf, eventPath, nameOf } from './document.ts';
import { isFragment } from './document-fragment.ts';
import { documentOfRoot, topOf } from './document-roots.ts';
import { domError, required } from './dom-error.ts';
import { marksHover } from './elements.ts';
import { dispatch, listen, unlisten, type Heard } from './events.ts';
import { isField } from './field.ts';
import { frameCreated } from './frame.ts';
import { setFrameView } from './frame-view.ts';
import { descendants, inDocument, isInDocument, lastInDocument } from './in-document.ts';
import { announcesDisabled, listenNatively, hasCapture, topLevel } from './listen.ts';
import { observing, removingAttribute, settingAttribute, together } from './mutation-observer.ts';
import { NODE_CONSTANTS } from './node-constants.ts';
import { isProcessingInstruction, targetOf } from './processing-instruction.ts';
import {
  asciiLower,
  asciiUpper,
  checkAttributeName,
  nameRecordOf,
  noteAttributeName,
  SVG,
  XHTML,
} from './qualified-name.ts';
import { BY_ELEMENT, GLOBAL } from './reflected-attributes.ts';
import { setStyleAttribute, styleOf } from './style-declaration.ts';
import { isKeptOnShape, isShape, writtenAttributes } from './svg.ts';
import { boxOf, fontFamilyOf, fontSizeOf, fontWeightOf, widthOf } from './svg-box.ts';
import { heldAnimation, webAnimation, type CoreAnimation } from './web-animation.ts';
import { engineOf } from './window.ts';

/** A node as a library holds one: an engine node with the members below on it. */
type Dom = EngineNode & Record<string, (...args: unknown[]) => unknown>;
type Listener = (event: unknown) => void;

/** What a node has in core that the members below take the place of. */
export interface CoreNode {
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
  getAnimations(): unknown[];
}

/**
 * The renderer each app's attributes are set through, by its engine: a script's `setAttribute`
 * is set as a template's attribute is, a `style` parsed into declarations and an `id` the view's
 * `nativeID`. A node of an app that has none is given the prop as written.
 */
const renderers = new WeakMap<Engine, Renderer2>();

/** Set the attributes of an app's nodes through its renderer, until it answers to undo it. */
export function setAttributesWith(engine: Engine, renderer: Renderer2): () => void {
  renderers.set(engine, renderer);
  return () => void renderers.delete(engine);
}

/** The prop an attribute is kept as, where it is not its name. */
const PROPS: Readonly<Record<string, string>> = { id: 'nativeID' };
const propOf = (name: string): string => PROPS[name] ?? name;

/**
 * HTML attributes React Native also reads as a typed prop. Android rejects a string where it
 * wants a boolean (`focusable="false"` is a native crash), so these are coerced. Others pass as
 * written: Fabric ignores a prop a view does not know.
 */
const BOOLEAN_ATTRIBUTES = new Set([
  'focusable',
  'aria-hidden',
  'aria-disabled',
  'aria-selected',
  'aria-expanded',
  'aria-busy',
  'aria-modal',
  'aria-checked',
  'accessible',
  'disabled',
]);

function attributeValue(name: string, value: string): unknown {
  if (!BOOLEAN_ATTRIBUTES.has(name)) return value;
  if (name === 'aria-checked' && value === 'mixed') return value;
  return value !== 'false';
}

/** What a boolean prop reads back as: `disabled` as the empty string a browser reflects it with. */
const asWritten = (name: string, value: boolean): string =>
  name === 'disabled' && value ? '' : String(value);

/**
 * The text of each attribute a script wrote, by element, where it is no prop to read it back
 * from as written: a `style`, and a boolean prop's own words.
 */
const written = new WeakMap<EngineNode, Map<string, string>>();

/** The names a script wrote that were attributes already: each keeps the place it had. */
const placed = new WeakMap<EngineNode, Set<string>>();

export function noteWritten(node: EngineNode, name: string, value: string | null): void {
  let all = written.get(node);
  if (value === null) {
    placed.get(node)?.delete(name);
    return void all?.delete(name);
  }
  if (!all) written.set(node, (all = new Map()));
  if (!all.has(name) && hasAttribute(node, name)) {
    placed.set(node, (placed.get(node) ?? new Set()).add(name));
  }
  all.set(name, value);
}

/** Give a copy of a node the text of each attribute a script wrote on it: see `cloneNode`. */
export function copyWritten(from: EngineNode, to: EngineNode): void {
  const all = written.get(from);
  if (all) written.set(to, new Map(all));
  const placedThere = placed.get(from);
  if (placedThere) placed.set(to, new Set(placedThere));
  // A copy of an iframe is a frame of its own, which a copy is not made as: see `frame.ts`.
  frameCreated(to, engineOf(to));
  const kept = taken.get(from);
  if (!kept) return;
  taken.set(to, new Map(kept));
  // And its view is shown by what the one it is a copy of took.
  for (const [name, value] of kept) setFrameView(to, name, value, engineOf(to));
}

/**
 * Each attribute an element's own view took, which is no prop to read it back from: an iframe's
 * `width`, which its web view is sized by, and its `src`, which it is shown as. Kept as written.
 */
const taken = new WeakMap<EngineNode, Map<string, string>>();

/** An attribute set as something else, or `null` for one taken away: see `taken`. */
export function keepTaken(node: EngineNode, name: string, value: unknown): void {
  const all = taken.get(node);
  if (value == null || value === false) return void all?.delete(name);
  if (all) all.set(name, String(value));
  else taken.set(node, new Map([[name, String(value)]]));
}

/**
 * Names in the order they were set: those set some other way first, a template's, as they come,
 * then those a script wrote, in the order it first wrote them. One a script wrote again where it
 * was set already keeps its place, as a browser keeps an attribute's.
 */
function inWrittenOrder(node: EngineNode, names: readonly string[]): string[] {
  const all = written.get(node);
  if (!all) return [...names];
  const kept = placed.get(node);
  const added = (name: string) => all.has(name) && !kept?.has(name);
  return [
    ...names.filter((name) => !added(name)),
    ...[...all.keys()].filter((name) => names.includes(name) && added(name)),
  ];
}

/** Set an attribute as a template sets one: through its app's renderer where it has one. */
function setAsWritten(node: EngineNode, name: string, value: unknown): void {
  const engine = engineOf(node);
  const renderer = renderers.get(engine);
  if (value === null) renderer?.removeAttribute(node, name);
  else renderer?.setAttribute(node, name, value as string);
  if (!renderer) engine.setProp(node, propOf(name), value);
}

/** The attributes an element keeps as written, where the props it is drawn by are another thing. */
const keptAttributes = (node: EngineNode): Readonly<Record<string, string>> =>
  node.tag === 'canvas' ? canvasAttributes(node) : writtenAttributes(node);

/** Whether an element has an attribute. */
function hasAttribute(node: EngineNode, name: string): boolean {
  if (name === 'class') return classAttribute(node) !== null;
  if (name === 'style') return written.get(node)?.has(name) ?? false;
  return attributeOf(node, name) !== null;
}

/**
 * Whether a prop is a state this package gives an element, which is no attribute of it: the
 * `aria-disabled` a `disabled` announces, the `data-hover` a pointer over it gives (see
 * `giveRole`), and the view box a canvas is drawn by (see `canvas.ts`).
 */
function isEngineState(node: EngineNode, key: string): boolean {
  if (isCanvasBox(node, key)) return true;
  if (key === 'aria-disabled') return announcesDisabled(node);
  return key === 'data-hover' && marksHover(node);
}

/**
 * An attribute kept as written, where the prop it is set as is another thing: one an iframe's web
 * view took, or a shape's.
 */
const keptAs = (node: EngineNode, name: string): string | undefined =>
  taken.get(node)?.get(name) ?? keptAttributes(node)[name];

/** An attribute as `getAttribute` answers it: the text written, or what the prop says. */
function attributeOf(node: EngineNode, name: string): string | null {
  if (name === 'class') return classAttribute(node);
  const text = written.get(node)?.get(name);
  if (name === 'style') return text ?? null;
  if (text === undefined && isEngineState(node, name)) return null;
  const value = keptAs(node, name) ?? node.props[propOf(name)];
  if (value == null) return null;
  if (typeof value !== 'boolean') return String(value);
  // A boolean prop is what the text was coerced to: the text itself is what was written.
  if (text !== undefined && attributeValue(name, text) === value) return text;
  return asWritten(name, value);
}

/** What a node is in: its parent, or the document it is at the top of a tree in. */
type TopOf = { readonly childNodes?: ArrayLike<EngineNode> };
const parentOf = (node: EngineNode): EngineNode | TopOf | null =>
  node.parent ?? (documentOfRoot(node) as TopOf | undefined) ?? null;

/** The nodes beside a node: its parent's, or its document's where it is at the top of one. */
function siblingsOf(node: EngineNode): readonly EngineNode[] {
  if (node.parent) return inDocument(node.parent);
  return Array.from((documentOfRoot(node) as TopOf | undefined)?.childNodes ?? []);
}

const sibling = (node: EngineNode, by: number): EngineNode | null => {
  const siblings = siblingsOf(node);
  const at = siblings.indexOf(node);
  return at === -1 ? null : (siblings[at + by] ?? null);
};

/** The nearest element before or after a node under its parent, past any text between. */
function elementBeside(node: EngineNode, step: 1 | -1): EngineNode | null {
  const all = node.parent ? inDocument(node.parent) : [];
  for (let at = all.indexOf(node) + step; at >= 0 && at < all.length; at += step) {
    if (all[at]!.nodeKind === 'element') return all[at]!;
  }
  return null;
}

/** The words of a text, and of every text under an element: none of a comment's. */
const textOf = (node: EngineNode): string =>
  node.nodeKind === 'text' ? node.nodeText : inDocument(node).map(textOf).join('');

/** Whether a node is an element of the DOM's: no text, no comment, no fragment. */
const isElement = (node: EngineNode): boolean => node.nodeKind === 'element' && !isFragment(node);

/**
 * An element's name as the DOM says it: upper case for one of HTML's in an HTML document, and as
 * it is written for any other, one a script made in another namespace or one of an XML
 * document's. A template's elements are HTML's.
 */
function domName(node: EngineNode): string {
  const name = nameRecordOf(node);
  if (!name) return isDrawn(node) ? ownName(node) : ownName(node).toUpperCase();
  const qualified = name.prefix === null ? name.localName : `${name.prefix}:${name.localName}`;
  return name.namespace === XHTML && !inXmlDocument(node) ? asciiUpper(qualified) : qualified;
}

/**
 * The namespace of an element: the one it was made in, or for what a template makes, SVG's for
 * what is written in an `<svg>` and HTML's for the rest.
 */
function namespaceOf(node: EngineNode): string | null {
  if (!isElement(node)) return null;
  const name = nameRecordOf(node);
  if (name) return name.namespace;
  return isDrawn(node) ? SVG : XHTML;
}

/** Whether an element is a drawing's, which the renderer made in SVG's namespace. */
const isDrawn = (node: EngineNode): boolean => node.namespace === 'svg';

/** The name an element was written as: the one a stylesheet reads, where it is kept by another. */
const ownName = (node: EngineNode): string => node.typeName ?? nameOf(node, engineOf(node));

/**
 * A name written as a native view's prop is: a capital after a small letter, `testID` or
 * `accessibilityLabel`. An app passes these through to the view it draws, and they are kept as
 * written; no HTML attribute is named so, and a library reads none of them back in lower case.
 * But for the name of a property HTML reflects, `accessKey`, which is an attribute's in any case.
 */
const PROP_CASE = /[a-z][A-Z]/;
const nativeProp = (node: EngineNode, name: string): boolean =>
  PROP_CASE.test(name) && !(name in GLOBAL) && !(name in (BY_ELEMENT[node.tag] ?? {}));

/**
 * The name an attribute is kept by on an element. An HTML element's are lower case, as a browser
 * makes them, and read by any case of them: one a script made keeps a name written so, but for a
 * native prop's. One a template made is written as it is given: a native prop's name has
 * capitals in it.
 */
function attributeNamed(node: EngineNode, given: unknown, writing = false): string {
  const name = String(given);
  if (namespaceOf(node) !== XHTML) return name;
  if (writing) return nameRecordOf(node) && !nativeProp(node, name) ? asciiLower(name) : name;
  const lower = asciiLower(name);
  // Written in lower case by a script, before a native prop of the name in another case.
  if (written.get(node)?.has(lower)) return lower;
  if (hasAttribute(node, name)) return name;
  return Object.keys(node.props).find((key) => asciiLower(key) === lower) ?? lower;
}

/**
 * The props an element is given for its native view, which are no attribute of it: whether it is
 * an element of its own to accessibility and can be focused, what draws an image, every name
 * written as a native prop's is (`accessibilityRole`, `pointerEvents`), and the states this
 * package gives one (see `isEngineState`). One a script or markup set is one all the same.
 */
const NATIVE_ONLY =
  /^(accessible|focusable|collapsable|source|editable|multiline|responsible)$|[a-z][A-Z]/;
function isNativeOnly(node: EngineNode, key: string): boolean {
  if (key === 'nativeID' || written.get(node)?.has(key)) return false;
  if (isEngineState(node, key)) return true;
  // A field's width in characters and what is typed in it.
  if (key === 'size' || key === 'text') return node.tag === 'input' || node.tag === 'textarea';
  return NATIVE_ONLY.test(key);
}

/** An element's attribute names, `class` and `style` among them, in the order they were set. */
function attributeNames(node: EngineNode): string[] {
  if (!isElement(node)) return [];
  // A shape's are kept as written, and its props are what it is drawn by.
  const names = Object.keys(node.props)
    .filter((key) => !(isShape(node) || node.tag === 'svg') || isKeptOnShape(key))
    .filter((key) => key !== 'style' && node.props[key] != null && !isNativeOnly(node, key))
    .map((key) => (key === 'nativeID' ? 'id' : key));
  const drawn = Object.keys(keptAttributes(node)).filter((name) => !names.includes(name));
  const all = [
    ...(classAttribute(node) === null ? [] : ['class']),
    ...(written.get(node)?.has('style') ? ['style'] : []),
    ...names,
    ...drawn,
    ...[...(taken.get(node)?.keys() ?? [])].filter(
      (name) => !names.includes(name) && !drawn.includes(name),
    ),
  ];
  return inWrittenOrder(node, all);
}

/**
 * Write an attribute by the name it is kept by, as `setAttribute` does once it has named it and
 * `setAttributeNS` does with the name it was given, in whatever case that is. Told to an observer
 * in the namespace given.
 */
export function writeAttribute(
  node: EngineNode,
  name: string,
  value: string,
  namespace: string | null = null,
): void {
  // Written with no namespace, until `setAttributeNS` says it is in one.
  noteAttributeName(node, name, null);
  settingAttribute(
    node,
    name,
    () => {
      noteWritten(node, name, value);
      if (name === 'class') return setClassAttribute(node, value);
      // Its declarations are `element.style`'s: see `style-declaration.ts`.
      if (name === 'style') return setStyleAttribute(node, value);
      setAsWritten(node, name, attributeValue(name, value));
    },
    namespace,
  );
}

/**
 * Attach a listener `addEventListener` was given to what native says of its type. Core maps the
 * events a `@defer` trigger listens for to the native ones that stand for them, and does nothing
 * with any other type. But a key down in a field is a key, and a click is the press a template's listener hears, with the event that
 * one is given: a library stops the click it acts on, which core's own event has nothing to stop
 * with. Any other type is the native event of its name.
 */
function attachNatively(node: EngineNode, type: string, heard: Heard, core: CoreNode) {
  // A key down in a field is a key, which native says: not the focus core takes it for.
  if (DEFER_TRIGGERS.has(type) && !(type === 'keydown' && isField(node))) {
    core.addEventListener.call(node, type, heard);
    return () => core.removeEventListener.call(node, type, heard);
  }
  const engine = engineOf(node);
  return (
    listenNatively(node, type, heard, engine) ??
    engine.setEventListener(node, topLevel(type), heard)
  );
}

/** The event types core's own `addEventListener` attaches, for `@defer`, but for a click. */
const DEFER_TRIGGERS = new Set(['keydown', 'mouseenter', 'focusin']);

/** The elements a script draws pictures from, by what `Object.prototype.toString` says of them. */
const PICTURE_TAGS: Readonly<Record<string, string>> = {
  canvas: 'HTMLCanvasElement',
  img: 'HTMLImageElement',
};

const get = (read: (this: Dom) => unknown, write?: (this: Dom, value: unknown) => void) => ({
  get: read,
  set: write,
});
const method = (value: (this: Dom, ...args: never[]) => unknown) => ({ value, writable: true });

/**
 * The DOM members every engine node answers to, for `extendNodes`. `core` is the node prototype
 * as it was: its listeners are what Angular's `@defer` triggers go through, and still do. The
 * tree's own are in `tree-members.ts`.
 */
export const nodeMembers = (core: CoreNode): PropertyDescriptorMap => ({
  // Upper case, as the DOM has an HTML element's: a library walking up stops at `HTML` or `BODY`.
  nodeName: get(function () {
    if (isFragment(this)) return '#document-fragment';
    if (this.nodeKind === 'anchor') return targetOf(this) ?? '#comment';
    if (this.nodeKind === 'text') return isCDATASection(this) ? '#cdata-section' : '#text';
    return domName(this);
  }),
  // A processing instruction's: a link's and a form's are the attribute, see `html-members.ts`.
  target: get(function () {
    return targetOf(this);
  }),
  // An element's own name, as `nodeName` gives it: the DOM has none for a text or a comment.
  tagName: get(function () {
    return isElement(this) ? domName(this) : undefined;
  }),
  localName: get(function () {
    if (!isElement(this)) return null;
    return nameRecordOf(this)?.localName ?? ownName(this);
  }),
  prefix: get(function () {
    return isElement(this) ? (nameRecordOf(this)?.prefix ?? null) : null;
  }),
  namespaceURI: get(function () {
    return namespaceOf(this);
  }),
  // The kind of node it is: the engine says an element of everything, for Angular's own check.
  nodeType: get(function () {
    if (isFragment(this)) return 11;
    if (this.nodeKind === 'anchor') return isProcessingInstruction(this) ? 7 : 8;
    if (this.nodeKind === 'text') return isCDATASection(this) ? 4 : 3;
    return 1;
  }),
  // `Node`'s constants, on every node as they are on a browser's: `nodeType` is compared with them.
  ...Object.fromEntries(Object.entries(NODE_CONSTANTS).map(([name, value]) => [name, { value }])),
  id: get(
    function () {
      return this.props['nativeID'] ?? '';
    },
    function (value) {
      settingAttribute(this, 'id', () => engineOf(this).setProp(this, 'nativeID', value));
    },
  ),

  // Told to an observer as it is named, even where it is set to what it was: see
  // `mutation-observer.ts`. By the name it is kept by: see `attributeNamed`.
  setAttribute: method(function (...args: unknown[]) {
    required(args, 2, 'setAttribute');
    const name = attributeNamed(this, checkAttributeName(String(args[0])), true);
    writeAttribute(this, name, String(args[1]));
  }),
  getAttribute: method(function (name: unknown) {
    return attributeOf(this, attributeNamed(this, name));
  }),
  hasAttribute: method(function (name: unknown) {
    return hasAttribute(this, attributeNamed(this, name));
  }),
  removeAttribute: method(function (given: unknown) {
    const name = attributeNamed(this, given);
    removingAttribute(this, name, () => {
      // Its node keeps the value it had: see `attr.ts`.
      attributeRemoved(this, name, attributeOf(this, name));
      noteAttributeName(this, name, null);
      const had = hasAttribute(this, name);
      noteWritten(this, name, null);
      if (name === 'class') return setClassAttribute(this, null);
      if (name === 'style') return setStyleAttribute(this, null);
      if (had) setAsWritten(this, name, null);
    });
  }),
  toggleAttribute: method(function (given: unknown, force?: boolean) {
    const name = checkAttributeName(String(given));
    const set = force ?? !this['hasAttribute']!(name);
    if (set) this['setAttribute']!(name, '');
    else this['removeAttribute']!(name);
    return set;
  }),
  getAttributeNames: method(function () {
    return attributeNames(this);
  }),
  hasAttributes: method(function () {
    return attributeNames(this).length > 0;
  }),

  // What a shape in a drawing takes up, and how long a text in one is: see `svg-box.ts`.
  getBBox: method(function () {
    return boxOf(this);
  }),
  getComputedTextLength: method(function () {
    return boxOf(this).width;
  }),
  // A text's characters, and how wide a run of them is drawn: what a chart cuts a label short by.
  getNumberOfChars: method(function () {
    return textOf(this).length;
  }),
  getSubStringLength: method(function (from: unknown, count: unknown) {
    const text = textOf(this);
    const start = Math.trunc(Number(from));
    if (!(start >= 0 && start < text.length)) {
      throw domError('The index is not in the range of the text.', 'IndexSizeError');
    }
    const run = text.slice(start, start + Math.max(0, Math.trunc(Number(count))));
    return widthOf(run, fontSizeOf(this), fontWeightOf(this), fontFamilyOf(this));
  }),
  // The drawing a shape is in: the nearest `<svg>` above it, and none for the drawing itself.
  ownerSVGElement: get(function () {
    for (let at = this.parent; at; at = at.parent) if (at.tag === 'svg') return at;
    return null;
  }),
  createSVGRect: method(() => ({ x: 0, y: 0, width: 0, height: 0 })),

  // What a chart library tells a picture it draws from an object by: see `canvas-picture.ts`.
  // A method, as the engine's members are named by strings and not by `Symbol.toStringTag`.
  toString: method(function () {
    const tag = Object.hasOwn(PICTURE_TAGS, this.tag) ? PICTURE_TAGS[this.tag] : undefined;
    return tag ? `[object ${tag}]` : Object.prototype.toString.call(this);
  }),

  // A library disables a control by the property as often as by the attribute: one is the other.
  // A form control's own is HTML's, in `reflected-attributes.ts`.
  disabled: get(
    function () {
      if (!isElement(this)) return undefined;
      const value = this.props['disabled'];
      return value != null && value !== false && value !== 'false';
    },
    function (value) {
      if (value) this['setAttribute']!('disabled', '');
      else this['removeAttribute']!('disabled');
    },
  ),

  // Written to, it is its `cssText` written, as a browser forwards it.
  style: get(
    function () {
      return isElement(this) ? styleOf(this) : undefined;
    },
    function (text) {
      if (isElement(this)) styleOf(this).cssText = text as string;
    },
  ),
  // Written to, it is its `value` written, as a browser forwards it.
  classList: get(
    function () {
      return classListOf(this);
    },
    function (value) {
      classListOf(this).value = String(value);
    },
  ),
  // A drawing's element has its classes as an object, which a chart library reads `baseVal` of.
  className: get(
    function () {
      const classes = classAttribute(this) ?? '';
      return isDrawn(this) ? { baseVal: classes, animVal: classes } : classes;
    },
    function (value) {
      setClassAttribute(this, String(value));
    },
  ),

  // The root is in the document, which is what a walk up from any node ends at, and so is a
  // comment a script put in the document beside it: see `document-children.ts`.
  parentNode: get(function () {
    return parentOf(this);
  }),
  // None where it is in a fragment, which is no element.
  parentElement: get(function () {
    return this.parent && !isFragment(this.parent) ? this.parent : null;
  }),
  // What it holds as a browser has it: no box a rule generated.
  firstChild: get(function () {
    return this.childList.find(isInDocument) ?? null;
  }),
  lastChild: get(function () {
    return lastInDocument(this) ?? null;
  }),
  firstElementChild: get(function () {
    return inDocument(this).find((child) => child.nodeKind === 'element') ?? null;
  }),
  nextSibling: get(function () {
    return sibling(this, 1);
  }),
  previousSibling: get(function () {
    return sibling(this, -1);
  }),
  nextElementSibling: get(function () {
    return elementBeside(this, 1);
  }),
  previousElementSibling: get(function () {
    return elementBeside(this, -1);
  }),
  // In the page's document: under its root, or beside it there.
  isConnected: get(function () {
    const top = topOf(this);
    return top === engineOf(this).root || documentOfRoot(top) !== undefined;
  }),
  contains: method(function (other: EngineNode | null) {
    for (let at = other; at; at = at.parent) if (at === this) return true;
    return false;
  }),
  // As the Web Animations API has them, and those of what it holds where asked: a dialog asks its
  // pane for the animations of its content. See `web-animation.ts`.
  getAnimations: method(function (options?: { subtree?: boolean }) {
    const nodes = options?.subtree ? [this, ...descendants(this)] : [this];
    return nodes.flatMap((node) => [
      ...[heldAnimation(node)].filter((held) => held !== undefined),
      ...(core.getAnimations.call(node) as CoreAnimation[]).flatMap(
        (animation) => webAnimation(animation, node) ?? [],
      ),
    ]);
  }),
  textContent: get(
    function () {
      return this.nodeKind === 'anchor' ? this.nodeText : textOf(this);
    },
    function (value) {
      const engine = engineOf(this);
      const text = value == null ? '' : String(value);
      if (isCharacterData(this)) return setData(this, text);
      // An element's text is all it holds: one text node, kept when it is all there already is,
      // and none for no text. Where something observes it, a new one, as a browser makes, and
      // one change for all of it.
      const [only] = this.childList;
      if (text && this.childList.length === 1 && only!.nodeKind === 'text' && !observing(this)) {
        return engine.setText(only!, text);
      }
      together(this, () => {
        for (const child of inDocument(this)) engine.removeChild(this, child);
        if (text) engine.appendChild(this, engine.createText(text));
      });
    },
  ),
  // The words of a text or a comment, and nothing of an element's, which is left as it is.
  nodeValue: get(
    function () {
      return isCharacterData(this) ? this.nodeText : null;
    },
    function (value) {
      setData(this, wordsOf(value));
    },
  ),
  // A node of a document `document.implementation` made is that document's: see
  // `dom-implementation.ts`. Any other is the page's, for an app that asked for one.
  ownerDocument: get(function () {
    return madeDocumentOf(this) ?? documentOf(engineOf(this)) ?? null;
  }),
  // What a URL an attribute of it says is resolved against: its document's.
  baseURI: get(function () {
    const document = (madeDocumentOf(this) ?? documentOf(engineOf(this))) as
      { baseURI?: unknown } | undefined;
    return typeof document?.baseURI === 'string' ? document.baseURI : 'about:blank';
  }),

  // A touch stays with the node that took it until it ends, so there is no capture to set or to
  // let go: a node has it for as long as the touch is on it.
  setPointerCapture: method(function () {}),
  releasePointerCapture: method(function () {}),
  hasPointerCapture: method(function () {
    return hasCapture(this);
  }),

  addEventListener: method(function (type: string, listener: Listener, options?: unknown) {
    listen(this, type, listener, options, (heard) => attachNatively(this, type, heard, core));
  }),
  removeEventListener: method(function (type: string, listener: Listener, options?: unknown) {
    unlisten(this, type, listener, options);
  }),
  // An event a script sends: to the listeners of the node and of what it is in, in the DOM's
  // order. See `events.ts`.
  dispatchEvent: method(function (event: unknown) {
    return dispatch(event, eventPath(engineOf(this), this));
  }),
});
