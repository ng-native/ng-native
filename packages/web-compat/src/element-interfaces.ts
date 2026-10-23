/**
 * The interfaces of HTML's elements as globals, `HTMLDivElement` to `HTMLVideoElement`, for what
 * a script does with one here: ask whether an element is one with `instanceof`. An element is
 * one where it is in HTML's namespace and named as HTML names the interface's elements, so one a
 * script makes in another namespace is none of them.
 *
 * ponytail: `instanceof` only, with no prototype a member could be added to, and no `new`.
 */

/** HTML's elements by the interface each is, where that is one of its own. */
const BY_INTERFACE: Readonly<Record<string, readonly string[]>> = {
  HTMLAnchorElement: ['a'],
  HTMLAreaElement: ['area'],
  HTMLAudioElement: ['audio'],
  HTMLBaseElement: ['base'],
  HTMLBodyElement: ['body'],
  HTMLBRElement: ['br'],
  HTMLButtonElement: ['button'],
  HTMLCanvasElement: ['canvas'],
  HTMLDataElement: ['data'],
  HTMLDataListElement: ['datalist'],
  HTMLDetailsElement: ['details'],
  HTMLDialogElement: ['dialog'],
  HTMLDirectoryElement: ['dir'],
  HTMLDivElement: ['div'],
  HTMLDListElement: ['dl'],
  HTMLEmbedElement: ['embed'],
  HTMLFieldSetElement: ['fieldset'],
  HTMLFontElement: ['font'],
  HTMLFormElement: ['form'],
  HTMLFrameElement: ['frame'],
  HTMLFrameSetElement: ['frameset'],
  HTMLHeadElement: ['head'],
  HTMLHeadingElement: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  HTMLHRElement: ['hr'],
  HTMLHtmlElement: ['html'],
  HTMLIFrameElement: ['iframe'],
  HTMLImageElement: ['img'],
  HTMLInputElement: ['input'],
  HTMLLabelElement: ['label'],
  HTMLLegendElement: ['legend'],
  HTMLLIElement: ['li'],
  HTMLLinkElement: ['link'],
  HTMLMapElement: ['map'],
  HTMLMarqueeElement: ['marquee'],
  HTMLMenuElement: ['menu'],
  HTMLMetaElement: ['meta'],
  HTMLMeterElement: ['meter'],
  HTMLModElement: ['del', 'ins'],
  HTMLObjectElement: ['object'],
  HTMLOListElement: ['ol'],
  HTMLOptGroupElement: ['optgroup'],
  HTMLOptionElement: ['option'],
  HTMLOutputElement: ['output'],
  HTMLParagraphElement: ['p'],
  HTMLParamElement: ['param'],
  HTMLPictureElement: ['picture'],
  HTMLPreElement: ['pre', 'listing', 'xmp'],
  HTMLProgressElement: ['progress'],
  HTMLQuoteElement: ['blockquote', 'q'],
  HTMLScriptElement: ['script'],
  HTMLSelectElement: ['select'],
  HTMLSlotElement: ['slot'],
  HTMLSourceElement: ['source'],
  HTMLSpanElement: ['span'],
  HTMLStyleElement: ['style'],
  HTMLTableCaptionElement: ['caption'],
  HTMLTableCellElement: ['td', 'th'],
  HTMLTableColElement: ['col', 'colgroup'],
  HTMLTableElement: ['table'],
  HTMLTableRowElement: ['tr'],
  HTMLTableSectionElement: ['tbody', 'thead', 'tfoot'],
  HTMLTemplateElement: ['template'],
  HTMLTextAreaElement: ['textarea'],
  HTMLTimeElement: ['time'],
  HTMLTitleElement: ['title'],
  HTMLTrackElement: ['track'],
  HTMLUListElement: ['ul'],
  HTMLVideoElement: ['video'],
};

/** HTML's elements that are an `HTMLElement` and no more. */
const PLAIN = new Set(
  (
    'abbr acronym address article aside b basefont bdi bdo big center cite code dd dfn dt em ' +
    'figcaption figure footer header hgroup i kbd main mark nav nobr noembed noframes noscript ' +
    'plaintext rb rp rt rtc ruby s samp search section small strike strong sub summary sup tt u ' +
    'var wbr'
  ).split(' '),
);

const XHTML = 'http://www.w3.org/1999/xhtml';

interface Named {
  readonly nodeType?: unknown;
  readonly namespaceURI?: unknown;
  readonly localName?: unknown;
}

/** The local name of an element of HTML's, or nothing for any other node. */
function htmlName(value: unknown): string | undefined {
  const node = value as Named | null;
  if (node?.nodeType !== 1 || node.namespaceURI !== XHTML) return undefined;
  return typeof node.localName === 'string' ? node.localName : undefined;
}

const KNOWN = new Set([...Object.values(BY_INTERFACE).flat(), ...PLAIN]);

/** A class `instanceof` asks `is` of, which cannot be made with `new`. */
function elementInterface(name: string, is: (localName: string) => boolean): object {
  return {
    [name]: class {
      constructor() {
        throw new TypeError('Illegal constructor');
      }
      static [Symbol.hasInstance](value: unknown): boolean {
        const local = htmlName(value);
        return local !== undefined && is(local);
      }
    },
  }[name]!;
}

export const elementInterfaces: Readonly<Record<string, object>> = {
  ...Object.fromEntries(
    Object.entries(BY_INTERFACE).map(([name, tags]) => [
      name,
      elementInterface(name, (local) => tags.includes(local)),
    ]),
  ),
  // One HTML does not know, whose name could be no custom element's either.
  HTMLUnknownElement: elementInterface(
    'HTMLUnknownElement',
    (local) => !KNOWN.has(local) && !local.includes('-'),
  ),
};
