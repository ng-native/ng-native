import type { Engine, EngineNode, TokenValue } from '@ng-native/fabric';
import { applyChanged } from './runtime-style.ts';
import { computedTransform } from './computed-transform.ts';
import { isShape } from './svg.ts';
import { fontSizeOf } from './svg-box.ts';
import { alphaText, canvasColour } from './canvas-colour.ts';
import { domError } from './dom-error.ts';
import { documentOf } from './document.ts';
import { tokenize } from './css-tokens.ts';
import { SYSTEM_COLOURS } from './css-colour-names.ts';
import { serializeString } from './css-value.ts';
import { drawn, sizeOf, styled } from './geometry.ts';

/**
 * `getComputedStyle`: a node's style as a browser resolves it, read only.
 *
 * Reading it lays the page out in a browser, with every style written so far, which is what a
 * library reads it for: Material's ripple does so between putting its element in at no size
 * and growing it, for the growth to be a transition. So what is pending is committed first.
 *
 * Each property is what is written on the element, else what the engine's cascade gave it
 * (`styleCache`, with what it inherits), else what its name gives it, else for an inherited
 * property its parent's, else the property's initial value. Then written as a browser writes a
 * computed value: a colour as `rgb()` or `rgba()`, a length in pixels, a transform as a matrix,
 * a shorthand of its sides as few as say them.
 *
 * ponytail: what only layout knows is answered from where native last laid the element out
 * where it is drawn, for `width` and `height` with none of their own, and as written otherwise:
 * a percentage is not worked out. A custom property is written back from the forms the engine
 * keeps of it, not as the words it was given. No property is `!important`.
 */

/** Its properties' initial values, by the name a script reads them by: also those it lists. */
const INITIAL: Readonly<Record<string, string>> = {
  alignContent: 'normal',
  alignItems: 'normal',
  alignSelf: 'auto',
  animationDelay: '0s',
  animationDuration: '0s',
  animationName: 'none',
  aspectRatio: 'auto',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  backgroundImage: 'none',
  borderBottomColor: 'currentcolor',
  borderBottomLeftRadius: '0px',
  borderBottomRightRadius: '0px',
  borderBottomStyle: 'none',
  borderBottomWidth: '0px',
  borderLeftColor: 'currentcolor',
  borderLeftStyle: 'none',
  borderLeftWidth: '0px',
  borderRightColor: 'currentcolor',
  borderRightStyle: 'none',
  borderRightWidth: '0px',
  borderTopColor: 'currentcolor',
  borderTopLeftRadius: '0px',
  borderTopRightRadius: '0px',
  borderTopStyle: 'none',
  borderTopWidth: '0px',
  bottom: 'auto',
  boxShadow: 'none',
  boxSizing: 'content-box',
  caretColor: 'currentcolor',
  color: 'rgb(0, 0, 0)',
  columnGap: 'normal',
  cursor: 'auto',
  direction: 'ltr',
  display: 'inline',
  flexBasis: 'auto',
  flexDirection: 'row',
  flexGrow: '0',
  flexShrink: '1',
  flexWrap: 'nowrap',
  float: 'none',
  fontFamily: 'system-ui',
  fontSize: '16px',
  fontStyle: 'normal',
  fontWeight: '400',
  height: 'auto',
  justifyContent: 'normal',
  left: 'auto',
  letterSpacing: 'normal',
  lineHeight: 'normal',
  marginBottom: '0px',
  marginLeft: '0px',
  marginRight: '0px',
  marginTop: '0px',
  maxHeight: 'none',
  maxWidth: 'none',
  minHeight: 'auto',
  minWidth: 'auto',
  objectFit: 'fill',
  opacity: '1',
  order: '0',
  outlineColor: 'currentcolor',
  outlineOffset: '0px',
  outlineStyle: 'none',
  outlineWidth: '0px',
  overflowX: 'visible',
  overflowY: 'visible',
  paddingBottom: '0px',
  paddingLeft: '0px',
  paddingRight: '0px',
  paddingTop: '0px',
  pointerEvents: 'auto',
  position: 'static',
  right: 'auto',
  rowGap: 'normal',
  textAlign: 'start',
  textDecorationColor: 'currentcolor',
  textDecorationLine: 'none',
  textTransform: 'none',
  top: 'auto',
  transform: 'none',
  transformOrigin: '50% 50%',
  transitionDelay: '0s',
  transitionDuration: '0s',
  transitionProperty: 'all',
  transitionTimingFunction: 'ease',
  userSelect: 'auto',
  verticalAlign: 'baseline',
  visibility: 'visible',
  whiteSpace: 'normal',
  width: 'auto',
  wordSpacing: '0px',
  zIndex: 'auto',
};

/** What a box takes from the one it is in where nothing says otherwise. */
const INHERITED = new Set([
  'caretColor',
  'color',
  'cursor',
  'direction',
  'fill',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'listStyleType',
  'pointerEvents',
  'stroke',
  'textAlign',
  'textIndent',
  'textShadow',
  'textTransform',
  'visibility',
  'whiteSpace',
  'wordBreak',
  'wordSpacing',
]);

/** The properties that are a length, which a browser answers in pixels. */
const LENGTH =
  /^(width|height|top|right|bottom|left|gap|rowGap|columnGap|fontSize|lineHeight|letterSpacing|wordSpacing|textIndent|flexBasis|outline(Width|Offset)|(min|max)(Width|Height)|(padding|margin)\w*|border\w*(Width|Radius))$/;
const COLOUR = /[cC]olor$|^(fill|stroke)$/;

/** The longhands a property written whole is kept as by its parts, by side or corner. */
const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
const CORNERS = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'];
const SHORTHANDS: Readonly<Record<string, readonly string[]>> = {
  margin: SIDES.map((side) => `margin${side}`),
  padding: SIDES.map((side) => `padding${side}`),
  inset: SIDES.map((side) => side.toLowerCase()),
  borderWidth: SIDES.map((side) => `border${side}Width`),
  borderStyle: SIDES.map((side) => `border${side}Style`),
  borderColor: SIDES.map((side) => `border${side}Color`),
  borderRadius: CORNERS.map((corner) => `border${corner}Radius`),
};
/** Shorthands written as their parts are, in order, where each part is a different property. */
const JOINED: Readonly<Record<string, readonly string[]>> = {
  ...Object.fromEntries(
    SIDES.map((side) => [
      `border${side}`,
      [`border${side}Width`, `border${side}Style`, `border${side}Color`],
    ]),
  ),
  outline: ['outlineColor', 'outlineStyle', 'outlineWidth'],
  flex: ['flexGrow', 'flexShrink', 'flexBasis'],
  flexFlow: ['flexDirection', 'flexWrap'],
};
/** Shorthands of two that are one value where both are the same. */
const PAIRS: Readonly<Record<string, readonly [string, string]>> = {
  gap: ['rowGap', 'columnGap'],
  overflow: ['overflowX', 'overflowY'],
};

/** What a side the engine keeps no value for is kept by instead: the engine's own shorthands. */
const KEPT_AS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(SHORTHANDS).flatMap(([whole, parts]) =>
    parts.map((part, at) => {
      const axis = at % 2 === 0 ? 'Vertical' : 'Horizontal';
      const engine = whole === 'margin' || whole === 'padding' ? [`${whole}${axis}`] : [];
      return [part, [...engine, whole]];
    }),
  ),
);

const camel = (name: string): string =>
  name.replace(/^-webkit-/, 'webkit-').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const dashed = (key: string): string => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Every property it lists, in the order `item` and an index read them: by name. */
const LISTED = Object.keys(INITIAL).map(dashed).sort();

type Inline = Record<string, unknown>;
interface Resolving {
  readonly node: EngineNode;
  /** What is written on the element itself, as `element.style` reads it. */
  readonly inline: Inline | undefined;
}

/** A colour as a computed one is written: `rgb()` where it is solid, else `rgba()`. */
function colourText(value: string): string {
  if (value === 'currentcolor' || value === 'currentColor') return value;
  const system = SYSTEM_COLOURS[value.toLowerCase()];
  if (system) return system;
  const colour = canvasColour(value);
  if (!colour) return value;
  const [r, g, b, a] = colour;
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alphaText(a)})`;
}

/** A length in `em` or `rem`, as the pixels it comes to. */
function pixels(value: string, node: EngineNode, base?: number): string {
  const found = /^(-?[\d.]+)(r?em)$/.exec(value);
  if (!found) return value;
  const size =
    found[2] === 'rem' ? 16 : (base ?? Number.parseFloat(String(resolved(node, 'fontSize'))));
  return `${Number(found[1]) * (Number.isFinite(size) ? size : 16)}px`;
}

/** A line height of no unit, or a percentage, as the pixels it comes to in the font's size. */
function lineHeightText(node: EngineNode, value: string): string {
  const found = /^([\d.]+)(%?)$/.exec(value.trim());
  if (!found) return pixels(value, node);
  const size = Number.parseFloat(resolved(node, 'fontSize')) || 16;
  return `${(Number(found[1]) * size) / (found[2] ? 100 : 1)}px`;
}

/** A transform the engine keeps as React Native's list, written as CSS's functions. */
function transformText(value: unknown): string {
  if (!Array.isArray(value)) return String(value);
  return (value as Record<string, unknown>[])
    .flatMap((step) => Object.entries(step))
    .map(
      ([name, by]) =>
        `${name}(${typeof by === 'number' && /^translate/.test(name) ? `${by}px` : String(by)})`,
    )
    .join(' ');
}

/** A value of the engine's, or as written on the element, as a browser writes it computed. */
/** What a generated box writes, as a string; `none` as it is. */
const contentText = (value: unknown): string =>
  value === 'none' || value === 'normal' ? value : serializeString(String(value));

function written(node: EngineNode, key: string, value: unknown): string {
  if (key === 'transform') return computedTransform(transformText(value));
  if (key === 'content') return contentText(value);
  if (key === 'lineHeight' && typeof value === 'string') return lineHeightText(node, value);
  if (typeof value === 'number') return LENGTH.test(key) ? `${value}px` : String(value);
  if (typeof value !== 'string') return Array.isArray(value) ? '' : String(value);
  if (COLOUR.test(key)) return colourText(value);
  return LENGTH.test(key) ? lengthText(node, key, value) : value;
}

/** A length in pixels: a font size in `em` a share of the one it is in, any other of its own. */
function lengthText(node: EngineNode, key: string, value: string): string {
  if (key !== 'fontSize') return pixels(value, node);
  const parent = node.parent?.nodeKind === 'element' ? node.parent : null;
  return parent ? pixels(value, parent) : pixels(value, node, 16);
}

/** What the element, a rule or its name gives a property, before anything is inherited. */
function specified(at: Resolving, key: string): unknown {
  // Under a rule's important declaration, as the engine has it: see `inlineOf` there.
  const own = at.node.styleCache?.important?.has(key) ? undefined : at.inline?.[key];
  if (own !== undefined && own !== '' && own !== null) return own;
  const value = styled(at.node, key);
  if (value != null) return value;
  for (const whole of KEPT_AS[key] ?? []) {
    const kept = styled(at.node, whole);
    if (kept != null) return kept;
  }
  return undefined;
}

/** A property's computed value on a node: its own, else what it inherits, else its initial. */
function resolved(node: EngineNode, key: string, inline?: Inline): string {
  const value = computed(node, key, inline);
  // A colour of the text's own, which is what is used.
  return key !== 'color' && /^currentcolor$/i.test(value) ? resolved(node, 'color', inline) : value;
}

function computed(node: EngineNode, key: string, inline?: Inline): string {
  const value = specified({ node, inline: inline ?? inlineOf(node) }, key);
  const keyword = typeof value === 'string' ? KEYWORDS[value.toLowerCase()] : undefined;
  if (value !== undefined && !keyword) return written(node, key, value);
  // `inherit` is the parent's, `initial` the property's own, `unset` either as it inherits.
  const parent = node.parent;
  const inherits = keyword === 'inherit' || (keyword !== 'initial' && INHERITED.has(key));
  if (inherits && parent?.nodeKind === 'element') return resolved(parent, key);
  return INITIAL[key] ?? '';
}

/** The CSS-wide keywords a value can be, each as what it says to take. */
const KEYWORDS: Readonly<Record<string, string>> = {
  inherit: 'inherit',
  initial: 'initial',
  unset: 'unset',
  revert: 'unset',
  'revert-layer': 'unset',
};

const inlineOf = (node: EngineNode): Inline | undefined =>
  (node as unknown as { style?: Inline }).style;

/** A shorthand of four sides or corners, in as few values as say them, or none where one is unset. */
function shorthand(parts: string[]): string {
  if (parts.some((part) => part === '')) return '';
  const [top, right, bottom, left] = parts;
  if (left !== right) return parts.join(' ');
  if (bottom !== top) return `${top} ${right} ${bottom}`;
  return right === top ? top! : `${top} ${right}`;
}

/** A custom property as text, from the forms the engine keeps of it. */
function tokenText(token: TokenValue | undefined): string {
  if (!token) return '';
  if (token.keyword !== undefined) return token.keyword;
  if (token.number !== undefined) return String(token.number);
  if (token.length !== undefined) {
    return typeof token.length === 'number' ? `${token.length}px` : token.length;
  }
  if (token.color !== undefined) return token.color;
  if (token.angle !== undefined) return `${token.angle}deg`;
  if (token.time !== undefined) return `${token.time}ms`;
  if (token.lengths)
    return token.lengths.map((each) => (typeof each === 'number' ? `${each}px` : each)).join(' ');
  return token.weight ?? token.family ?? '';
}

/** The pseudo-elements a browser resolves a style for, by the names it takes them by. */
const PSEUDO =
  /^::?(before|after|marker|placeholder|first-line|first-letter|selection|backdrop|file-selector-button)$|^::(details-content|checkmark|picker-icon)$/;

/**
 * A pseudo-element as it was asked for, its name read as CSS reads an identifier, `:bef\\oRE`
 * as `:before`: or nothing where anything follows it, a space among them.
 */
function pseudoName(asked: string): string {
  const tokens = tokenize(asked);
  const colons = tokens.findIndex((token) => token.type !== 'colon');
  const name = tokens[colons];
  if (colons < 1 || colons > 2 || name?.type !== 'ident' || tokens.length !== colons + 1) return '';
  return `${':'.repeat(colons)}${name.value.toLowerCase()}`;
}

/** What a computed style is of: an element, a pseudo-element that is none, or nothing. */
type Of = 'element' | 'pseudo' | 'none';
const NODE = Symbol('node');
const OF = Symbol('of');
const INLINE = Symbol('inline');

/** The computed style of an element, or of one of its pseudo-elements. */
class ComputedStyle {
  readonly [NODE]: EngineNode;
  readonly [OF]: Of;
  [INLINE]: Inline | undefined;

  constructor(node: EngineNode, of: Of) {
    this[NODE] = node;
    this[OF] = of;
  }

  get parentRule(): null {
    return null;
  }
  get cssText(): string {
    return '';
  }
  set cssText(_: string) {
    throw readOnly();
  }
  get length(): number {
    return this[OF] === 'none' ? 0 : LISTED.length;
  }
  item(at: number): string {
    return (this[OF] === 'none' ? undefined : LISTED[at]) ?? '';
  }
  getPropertyPriority(): string {
    return '';
  }
  *[Symbol.iterator](): IterableIterator<string> {
    for (let at = 0; at < this.length; at++) yield this.item(at);
  }
  setProperty(): never {
    throw readOnly();
  }
  removeProperty(): never {
    throw readOnly();
  }

  getPropertyValue(name: unknown): string {
    const text = String(name);
    if (this[OF] === 'none') return '';
    if (text.startsWith('--')) return tokenText(this[NODE].styleCache?.tokens?.[text]);
    return this.read(camel(text.toLowerCase()));
  }

  /**
   * A property of a pseudo-element that is not there: what it inherits from its element, and
   * the rest initial. One that is no pseudo-element has none.
   */
  private readMissing(key: string): string {
    const node = this[NODE];
    if (this[OF] === 'none') return '';
    // Its element is its parent: an item of a flex or grid container is a block.
    if (key === 'display' && /flex|grid/.test(resolved(node, 'display'))) return 'block';
    return INHERITED.has(key) ? resolved(node, key) : (INITIAL[key] ?? '');
  }

  /** A property by the name a script reads it by: `paddingTop`, `cssFloat`. */
  read(key: string): string {
    const node = this[NODE];
    if (this[OF] !== 'element') return this.readMissing(key);
    if (key === 'cssFloat') return this.read('float');
    if (key.includes('-')) return this.read(camel(key));
    const physical = physicalOf(key, () => resolved(node, 'direction'));
    if (physical) return this.read(physical);
    // Live: what a script changed since it was asked for is applied first.
    settle(node);
    const whole = wholeOf(key, (part) => this.read(part));
    if (whole !== undefined) return whole;
    // A text of a drawing is measured by its font size, which a chart library reads in pixels.
    if (key === 'fontSize' && isShape(node)) return `${fontSizeOf(node)}px`;
    this[INLINE] ??= inlineOf(node);
    return settled(node, key, resolved(node, key, this[INLINE]));
  }
}

/**
 * A logical property as the physical one it is, as a box written from left to right and top to
 * bottom has it, or right to left where its direction says: `margin-inline-start` is
 * `margin-left`, `inline-size` is `width`. Nothing for a property that is no logical one.
 *
 * ponytail: a vertical writing mode is not read.
 */
function physicalOf(key: string, direction: () => string): string | undefined {
  const sized = /^(min|max)?([Ii]nline|[Bb]lock)Size$/.exec(key);
  if (sized) {
    const size = /^[Ii]/.test(sized[2]!) ? 'Width' : 'Height';
    return sized[1] ? `${sized[1]}${size}` : size.toLowerCase();
  }
  const found =
    /^(margin|padding|scrollMargin|scrollPadding|inset|border)(Block|Inline)(Start|End)(Width|Style|Color)?$/.exec(
      key,
    );
  if (!found) return undefined;
  const [, box, axis, end, part = ''] = found;
  const rtl = axis === 'Inline' && direction() === 'rtl';
  const side =
    axis === 'Block'
      ? end === 'Start'
        ? 'Top'
        : 'Bottom'
      : (end === 'Start') !== rtl
        ? 'Left'
        : 'Right';
  return box === 'inset' ? side.toLowerCase() : `${box}${side}${part}`;
}

/** A shorthand by its parts, or `undefined` for a property that is none. */
function wholeOf(key: string, read: (part: string) => string): string | undefined {
  const sides = SHORTHANDS[key];
  if (sides) return shorthand(sides.map(read));
  const joined = JOINED[key];
  if (joined) return joined.map(read).join(' ');
  const pair = PAIRS[key];
  if (pair) {
    const [one, other] = pair.map(read);
    return one === other ? one : `${one} ${other}`;
  }
  if (key !== 'border') return undefined;
  const each = SIDES.map((side) => read(`border${side}`));
  return each.every((side) => side === each[0]) ? each[0] : '';
}

/** Whether a name is a property's, as a computed style has one for each: `in` answers so. */
function isKnown(name: string): boolean {
  const key = name.includes('-') ? camel(name) : name;
  return [INITIAL, SHORTHANDS, JOINED, PAIRS].some((each) => key in each) || WHOLE.has(key);
}
const WHOLE = new Set(['border', 'font', 'cssFloat']);

/** What only layout knows: a `width` or `height` with none of its own, where it is drawn. */
function laidOut(node: EngineNode, key: 'width' | 'height'): string | undefined {
  if (!drawn(node)) return undefined;
  const size = sizeOf(node)[key];
  const [from, to] = key === 'width' ? ['Left', 'Right'] : ['Top', 'Bottom'];
  const inside = ['padding', 'border'].reduce((sum, edge) => {
    const suffix = edge === 'border' ? 'Width' : '';
    const near = Number.parseFloat(resolved(node, `${edge}${from}${suffix}`)) || 0;
    const far = Number.parseFloat(resolved(node, `${edge}${to}${suffix}`)) || 0;
    return sum + near + far;
  }, 0);
  const border = resolved(node, 'boxSizing') === 'border-box';
  return `${Math.max(0, border ? size : size - inside)}px`;
}

/**
 * What layout settles of a value: a size with none of its own, a minimum of `auto`, and the
 * box of an item of a flex or grid container.
 */
function settled(node: EngineNode, key: string, value: string): string {
  if (key === 'display') return blockified(node, listItem(node, value));
  if (value !== 'auto') return value;
  // A box that is none, or is its children's, has no size of its own to lay out.
  const display = key === 'width' || key === 'height' ? resolved(node, 'display') : 'none';
  if (!/^(none|contents)$/.test(display)) return laidOut(node, key as 'width') ?? value;
  return key === 'minWidth' || key === 'minHeight' ? minimum(node) : value;
}

/** The elements a browser's own stylesheet makes list items, which the engine lays out as blocks. */
const LIST_ITEMS = new Set(['li', 'summary']);

/** `list-item` for one of `LIST_ITEMS` that is a block by its default alone, as a browser has it. */
function listItem(node: EngineNode, display: string): string {
  if (display !== 'block' || !LIST_ITEMS.has(node.tag)) return display;
  const own =
    (node.props['style'] as Record<string, unknown> | undefined)?.['display'] ??
    node.styleCache?.style['display'];
  return own === undefined ? 'list-item' : display;
}

/** The display of a box an item of a flex or grid container is, which is a block's. */
const BLOCKIFIED: Readonly<Record<string, string>> = {
  inline: 'block',
  'inline-block': 'block',
  'inline-flex': 'flex',
  'inline-grid': 'grid',
  'inline-table': 'table',
  'list-item inline': 'list-item',
};

function blockified(node: EngineNode, display: string): string {
  const parent = node.parent;
  if (!parent || parent.nodeKind !== 'element' || !BLOCKIFIED[display]) return display;
  return /flex|grid/.test(resolved(parent, 'display')) ? BLOCKIFIED[display]! : display;
}

/** `min-width: auto` as a browser resolves it: itself in a flex or grid box, else `0px`. */
function minimum(node: EngineNode): string {
  const display = node.parent ? styled(node.parent, 'display') : undefined;
  return typeof display === 'string' && /flex|grid/.test(display) ? 'auto' : '0px';
}

const readOnly = () =>
  domError('A computed style cannot be changed.', 'NoModificationAllowedError');

/** Whether a name is one a computed style answers by: anything not its own member, or symbol. */
const isProperty = (key: string | symbol, target: object): key is string =>
  typeof key === 'string' && !(key in target);

function declaration(node: EngineNode, of: Of): ComputedStyle {
  const style = new ComputedStyle(node, of);
  return new Proxy(style, {
    get(target, key) {
      if (!isProperty(key, target)) {
        const member = Reflect.get(target, key, target) as unknown;
        return typeof member === 'function' ? member.bind(target) : member;
      }
      if (/^\d+$/.test(key)) return target.item(Number(key)) || undefined;
      return target.read(key);
    },
    set(target, key) {
      if (key === 'cssText' || isProperty(key, target)) throw readOnly();
      return false;
    },
    has(target, key) {
      if (key in target) return true;
      if (typeof key !== 'string') return false;
      return /^\d+$/.test(key) ? Number(key) < target.length : isKnown(key);
    },
  });
}

/** Whether an element is in no tree, which has no style, as one in no document has none in a browser. */
const inNoTree = (node: EngineNode, engine: Engine | undefined): boolean =>
  !node.parent &&
  node !== engine?.root &&
  (!engine || documentOf(engine)?.documentElement !== node);

/** The engine a node is in. */
const engineOf = (node: EngineNode): Engine | undefined =>
  (node as unknown as { engine?: Engine }).engine;

/** Apply what a script changed of the sheets and the tree, as a browser styles before it answers. */
function settle(node: EngineNode): void {
  applyChanged();
  const engine = engineOf(node);
  if (engine?.pending) engine.commit();
}

/**
 * `getComputedStyle(element, pseudo)`. A pseudo-element the engine draws is read as the box it
 * is; one that is none is given what it would inherit; a name that is no pseudo-element, none.
 */
export function computedStyle(node: EngineNode, pseudo?: unknown): unknown {
  const engine = engineOf(node);
  settle(node);
  // No longer new: a change from here is one to ease, as it is in the frame after a first one.
  if (engine) node.bornIn = undefined;
  if (inNoTree(node, engine)) return declaration(node, 'none');
  const asked = pseudo == null ? '' : String(pseudo);
  if (!asked.startsWith(':')) return declaration(node, 'element');
  const name = PSEUDO.exec(pseudoName(asked));
  if (!name) return declaration(node, 'none');
  const box = node.childList.find((child) => child.tag === `::${name[1] ?? name[2]}`);
  return box ? declaration(box, 'element') : declaration(node, 'pseudo');
}
